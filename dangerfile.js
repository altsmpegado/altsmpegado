import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const pr = danger.github.pr;

async function createNotionEntry() {
  await notion.pages.create({
    parent: { database_id: process.env.NOTION_DATABASE_ID },
    properties: {
      Name: {
        title: [
          {
            text: { content: pr.title },
          },
        ],
      },
      "PR URL": {
        url: pr.html_url,
      },
      Repository: {
        rich_text: [
          {
            text: { content: danger.github.repo.full_name },
          },
        ],
      },
      Status: {
        select: {
          name: "Open",
        },
      },
    },
  });
}

schedule(createNotionEntry());
