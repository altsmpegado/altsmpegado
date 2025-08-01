const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const userMap = {
    "altsmpegado": "d8974b57-089f-498d-8be6-f83c3506b091"
};

function extractDateFromBody(body, label) {
    const regex = new RegExp(`### ${label}\\s+(\\d{2}/\\d{2}/\\d{4})`, "i");
    const match = body.match(regex);
    if (!match) return null;
    // Convert DD/MM/YYYY to YYYY-MM-DD
    const [day, month, year] = match[1].split("/");
    return `${year}-${month.padStart(2,"0")}-${day.padStart(2,"0")}`;
}

function cleanDescription(body) {
    return body.replace(/### Start\s+\d{2}\/\d{2}\/\d{4}/i, "")
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

    return response.results[0]; // returns undefined if not found
}

async function deleteAllBlocks(pageId) {
    // Get children blocks
    const blocks = await notion.blocks.children.list({ block_id: pageId });
    for (const block of blocks.results) {
        await notion.blocks.delete({ block_id: block.id });
    }
}

async function addCommentToNotionPage(pageId, commentBody) {
    try {
        const response = await notion.comments.create({
            parent: { page_id: pageId },
            rich_text: [
            {
                type: "text",
                text: {
                    content: commentBody
                }
            }
            ]
        });

        console.log("Comment added:", response);
    } catch (error) {
        console.error("Failed to add comment to Notion:", error);
    }
}

async function handleNewGithubComment(commentBody, issueUrl) {
    const page = await findPageByIssueUrl(issueUrl);
    if (page) {
        await addCommentToNotionPage(page.id, commentBody);
    } else {
        console.warn("No Notion page found for the issue to comment on.");
    }
}

async function createOrUpdateIssueInNotion() {
    const labelsJson = process.env.ISSUE_LABELS || "[]";
    const labels = JSON.parse(labelsJson).map(label => label.name);

    const assigneeGitHub = process.env.ISSUE_ASSIGNEE;
    const notionAssigneeId = userMap[assigneeGitHub];

    const issueBodyRaw = process.env.ISSUE_BODY;
    const startDate = extractDateFromBody(issueBodyRaw, "Start");
    const dueDate = extractDateFromBody(issueBodyRaw, "Due");
    const issueBodyCleaned = cleanDescription(issueBodyRaw);

    const properties = {
        Name: {
            title: [{ text: { content: process.env.ISSUE_TITLE } }],
        },
        "Issue URL": {
            url: process.env.ISSUE_URL,
        },
        Status: {
            status: { name: process.env.ISSUE_STATE === "open" ? "Open" : "Closed" },
        },
        Labels: {
            multi_select: labels.map(name => ({ name })),
        },
        Repository: {
            rich_text: [{ text: { content: process.env.REPO_NAME } }],
        },
    };

    if (notionAssigneeId) {
        properties.Assignee = {
            people: [{ id: notionAssigneeId }],
        };
    }

    if (startDate && dueDate) {
        properties.Date = { date: { start: startDate, end: dueDate } };
    } else if (startDate) {
        properties.Date = { date: { start: startDate } };
    } else if (dueDate) {
        properties.Date = { date: { start: dueDate } };
    }

    const existingPage = await findPageByIssueUrl(process.env.ISSUE_URL);

    if (existingPage) {
        await notion.pages.update({
            page_id: existingPage.id,
            properties,
        });

        await deleteAllBlocks(existingPage.id);

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
                                text: { content: issueBodyCleaned },
                            },
                        ],
                    },
                },
            ],
        });

    } else {
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
                                text: { content: issueBodyCleaned },
                            },
                        ],
                    },
                },
            ],
        });
    }

    const commentBody = process.env.COMMENT_BODY;
    const commentAuthor = process.env.COMMENT_AUTHOR;
    const fullComment = `💬 ${commentAuthor} : ${commentBody}`;
    if (commentBody) {
        await handleNewGithubComment(fullComment, process.env.ISSUE_URL);
    }
}

createOrUpdateIssueInNotion().catch(console.error);
