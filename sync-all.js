const { Client } = require("@notionhq/client");
const fetch = global.fetch || require("node-fetch");

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const userMap = {
  "altsmpegado": "d8974b57-089f-498d-8be6-f83c3506b091"
};

function extractDateFromBody(body, label) {
  const regex = new RegExp(`### ${label}\\s+(\\d{2}/\\d{2}/\\d{4})`, "i");
  const match = body.match(regex);
  if (!match) return null;
  const [day, month, year] = match[1].split("/");
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function cleanDescription(body) {
  return body
    .replace(/### Start\s+\d{2}\/\d{2}\/\d{4}/i, "")
    .replace(/### Due\s+\d{2}\/\d{2}\/\d{4}/i, "")
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

async function deleteAllBlocks(pageId) {
  const blocks = await notion.blocks.children.list({ block_id: pageId });
  for (const block of blocks.results) {
    await notion.blocks.delete({ block_id: block.id });
  }
}

async function syncIssue(issue) {
  const issueUrl = issue.html_url;
  const issueTitle = issue.title;
  const issueBodyRaw = issue.body || "No description";
  const issueState = issue.state;
  const repoName = issue.repository_url.split("/").pop();
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
    // Update properties
    await notion.pages.update({
      page_id: existingPage.id,
      properties,
    });
    // Clear old content
    await deleteAllBlocks(existingPage.id);
    // Add new issue body as rich text blocks
    await notion.blocks.children.append({
      block_id: existingPage.id,
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [
              {
                type: "text",
                text: { content: issueBodyCleaned || "No description" },
              },
            ],
          },
        },
      ],
    });
  } else {
    // Create new page with properties and issue body content
    await notion.pages.create({
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties,
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [
              {
                type: "text",
                text: { content: issueBodyCleaned || "No description" },
              },
            ],
          },
        },
      ],
    });
  }
}

async function fetchAndSyncAllIssues() {
  const repoFullName = process.env.REPO_FULL_NAME; // e.g. "user/repo"
  const perPage = 100;
  let page = 1;
  let fetched;

  do {
    const res = await fetch(
      `https://api.github.com/repos/${repoFullName}/issues?state=all&per_page=${perPage}&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
    }

    fetched = await res.json();
    const issuesOnly = fetched.filter(issue => !issue.pull_request);

    for (const issue of issuesOnly) {
      await syncIssue(issue);
    }

    page++;
  } while (fetched.length === perPage);

  console.log("All GitHub issues synced to Notion.");
}

fetchAndSyncAllIssues().catch(console.error);
