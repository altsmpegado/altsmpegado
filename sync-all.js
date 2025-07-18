const { Client } = require("@notionhq/client");
const fetch = require("node-fetch");

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const userMap = {
  "altsmpegado": "d8974b57-089f-498d-8be6-f83c3506b091"
};

function extractDateFromBody(body, label) {
  const regex = new RegExp(`## ${label}\\s+(\\d{2}/\\d{2}/\\d{4})`, "i");
  const match = body.match(regex);
  if (!match) return null;
  const [day, month, year] = match[1].split("/");
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function cleanDescription(body) {
  return body
    .replace(/## Start\s+\d{2}\/\d{2}\/\d{4}/i, "")
    .replace(/## Due\s+\d{2}\/\d{2}\/\d{4}/i, "")
    .trim();
}

async function findPageByIssueUrl(issueUrl) {
  const response = await notion.databases.query({
    database_id: process.env.NOTION_DATABASE_ID,
    filter: {
      property: "Issue URL",
      url: { equals: issueUrl },
    },
  });
  return response.results[0];
}

async function syncComments(issue, notionPageId) {
  if (issue.comments === 0) return; // no comments to sync

  const res = await fetch(issue.comments_url, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new Error(`Failed fetching comments: ${await res.text()}`);

  const comments = await res.json();

  for (const comment of comments) {
    await notion.comments.create({
      parent: { page_id: notionPageId },
      rich_text: [
        {
          type: "text",
          text: { content: `${comment.user.login}: ${comment.body}` },
        },
      ],
      display_name: { type: "integration" },
    });
  }
}

async function syncIssueToNotion(issue) {
  const issueUrl = issue.html_url;
  const issueTitle = issue.title;
  const issueBodyRaw = issue.body || "No description";
  const issueState = issue.state;
  const repoName = issue.repository_url.split("/").slice(-1)[0];
  const assigneeGitHub = issue.assignee?.login;
  const labels = issue.labels.map(label => label.name);

  const startDate = extractDateFromBody(issueBodyRaw, "Start");
  const dueDate = extractDateFromBody(issueBodyRaw, "Due");
  const issueBodyCleaned = cleanDescription(issueBodyRaw);
  const notionAssigneeId = userMap[assigneeGitHub];

  const properties = {
    Name: { title: [{ text: { content: issueTitle } }] },
    "Issue URL": { url: issueUrl },
    Status: { status: { name: issueState === "open" ? "Open" : "Closed" } },
    Labels: { multi_select: labels.map(name => ({ name })) },
    Repository: { rich_text: [{ text: { content: repoName } }] },
    Description: { rich_text: [{ text: { content: issueBodyCleaned || "No description" } }] },
  };

  if (notionAssigneeId) {
    properties.Assignee = { people: [{ id: notionAssigneeId }] };
  }

  if (startDate && dueDate) {
    properties.Date = { date: { start: startDate, end: dueDate } };
  } else if (startDate) {
    properties.Date = { date: { start: startDate } };
  } else if (dueDate) {
    properties.Date = { date: { start: dueDate } };
  }

  const existingPage = await findPageByIssueUrl(issueUrl);

  if (existingPage) {
    await notion.pages.update({
      page_id: existingPage.id,
      properties,
    });
    await syncComments(issue, existingPage.id);
  } else {
    const newPage = await notion.pages.create({
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties,
    });
    await syncComments(issue, newPage.id);
  }
}

async function fetchAllGitHubIssues() {
  const repo = process.env.REPO_FULL_NAME; // e.g. "username/repo"
  const perPage = 100;
  let page = 1;
  let issues = [];
  let fetched;

  do {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues?state=all&per_page=${perPage}&page=${page}`, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) {
      console.error("GitHub API error:", await res.text());
      return;
    }
    fetched = await res.json();
    const filtered = fetched.filter(issue => !issue.pull_request);
    issues.push(...filtered);
    page++;
  } while (fetched.length === perPage);

  for (const issue of issues) {
    await syncIssueToNotion(issue);
  }

  console.log(`Synced ${issues.length} issues.`);
}

fetchAllGitHubIssues().catch(console.error);
