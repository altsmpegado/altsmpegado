const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function listUsers() {
  const res = await notion.users.list();
  res.results.forEach(user => {
    console.log(`${user.name} — ${user.id}`);
  });
}

listUsers();

const userMap = {
  "altsmpegado": "notion-user-id-abc123"
};

async function createOrUpdateIssueInNotion() {
  const labelsJson = process.env.ISSUE_LABELS || "[]";
  const labels = JSON.parse(labelsJson).map(label => label.name);

  const assigneeGitHub = process.env.ISSUE_ASSIGNEE;
  const notionAssigneeId = userMap[assigneeGitHub];

  const properties = {
    Name: {
      title: [
        {
          text: { content: process.env.ISSUE_TITLE },
        },
      ],
    },
    "Issue URL": {
      url: process.env.ISSUE_URL,
    },
    Status: {
      status: {
        name: process.env.ISSUE_STATE === "open" ? "Open" : "Closed",
      },
    },
    Labels: {
      multi_select: labels.map(name => ({ name })),
    },
    Description: {
      rich_text: [
        {
          text: { content: process.env.ISSUE_BODY || "No description" },
        },
      ],
    },
    Repository: {
      rich_text: [
        {
          text: { content: process.env.REPO_NAME },
        },
      ],
    },
  };

  if (notionAssigneeId) {
    properties.Assignee = {
      people: [{ id: notionAssigneeId }],
    };
  }

  await notion.pages.create({
    parent: { database_id: process.env.NOTION_DATABASE_ID },
    properties,
  });
}

createOrUpdateIssueInNotion().catch(console.error);
