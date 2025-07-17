const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const userMap = {
    "altsmpegado": "d8974b57-089f-498d-8be6-f83c3506b091"
};

function extractDateFromBody(body, label) {
    const regex = new RegExp(`## ${label}\\s+(\\d{4}-\\d{2}-\\d{2})`, "i");
    const match = body.match(regex);
    return match ? match[1] : null;
}

async function findPageByIssueUrl(issueUrl) {
    const response = await notion.databases.query({
        database_id: process.env.NOTION_DATABASE_ID,
        filter: {
            property: "Issue URL",
            url: { equals: issueUrl },
        },
    });

    return response.results[0]; // returns undefined if not found
}

async function createOrUpdateIssueInNotion() {
    const labelsJson = process.env.ISSUE_LABELS || "[]";
    const labels = JSON.parse(labelsJson).map(label => label.name);

    const assigneeGitHub = process.env.ISSUE_ASSIGNEE;
    const notionAssigneeId = userMap[assigneeGitHub];

    const issueBody = process.env.ISSUE_BODY || "No description";
    const startDate = extractDateFromBody(issueBody, "Start");
    const dueDate = extractDateFromBody(issueBody, "Due");

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

    if (startDate && dueDate) {
        properties["Date"] = {
            date: {
                start: startDate,
                end: dueDate,
            },
        };
    } else if (startDate) {
        properties["Date"] = {
            date: { start: startDate },
        };
    } else if (dueDate) {
        properties["Date"] = {
            date: { start: dueDate },
        };
    }

    const existingPage = await findPageByIssueUrl(process.env.ISSUE_URL);

    if (existingPage) {
        await notion.pages.update({
            page_id: existingPage.id,
            properties,
        });
    } else {
        await notion.pages.create({
            parent: { database_id: process.env.NOTION_DATABASE_ID },
            properties,
        });
    }
}

createOrUpdateIssueInNotion().catch(console.error);
