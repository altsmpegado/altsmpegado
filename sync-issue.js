const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function createOrUpdateIssueInNotion() {
  const labelsJson = process.env.ISSUE_LABELS || "[]";
  const labels = JSON.parse(labelsJson).map(label => label.name);

  await notion.pages.create({
    parent: { database_id: process.env.NOTION_DATABASE_ID },
    properties: {
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
        select: {
          name: process.env.ISSUE_STATE === "open" ? "Open" : "Closed",
        },
      },
      Labels: {
        multi_select: labels.map(name => ({ name })),
      },
      Repository: {
        rich_text: [
          {
            text: { content: process.env.REPO_NAME },
          },
        ],
      },
    },
  });
}

createOrUpdateIssueInNotion().catch(console.error);
