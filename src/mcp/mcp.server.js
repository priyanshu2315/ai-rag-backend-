import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as documentService from "../services/document.service.js";
import { z } from "zod";
import * as documentRepository from "../repositories/document.repository.js";
import {
  canAccessDocument,
  getAccessibleDocumentIds,
} from "../services/access.service.js";
import * as chatRepository from "../repositories/chat.repository.js";
import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import { cragPipeline } from "../services/crag.service.js";
import { checkpointer } from "../config/checkpointer.js";
import * as aiService from "../services/ai.service.js";

const text = (value) => ({ content: [{ type: "text", text: value }] });

const fail = (message) => ({ ...text(message), isError: true });

const NOT_FOUND = "Document not found.";

// "Sources:" list under the answer, one line per document page.
const formatSources = (citations = []) => {
  const labels = [
    ...new Set(
      citations.map((c) => `- ${c.displayLabel} (documentId: ${c.documentId})`),
    ),
  ];
  return labels.length ? `\n\nSources:\n${labels.join("\n")}` : "";
};

// Turns CRAG events into MCP progress messages (only if the client asked for them).
function createProgressSender(extra) {
  const progressToken = extra?._meta?.progressToken;
  let progress = 0;

  return (event) => {
    if (progressToken === undefined) return;

    let message = null;
    if (event.type === "tool_start") message = `${event.tool}: ${event.query}`;
    else if (event.type === "status") message = event.message;
    else if (event.type === "agent_start")
      message = `Web research: ${event.task}`;
    if (!message) return;

    progress += 1; // must go up with every message
    extra
      .sendNotification({
        method: "notifications/progress",
        params: { progressToken, progress, message },
      })
      .catch(() => {}); // a lost progress message must not break the search
  };
}

// Asks the human (through their MCP client) to allow the web search.
// Returns true / false, or null when the client cannot ask.
async function askWebApproval(server, pause, extra) {
  if (!server.server.getClientCapabilities()?.elicitation) return null;

  const tasks = pause.webHops.map((hop) => `- ${hop.task}`).join("\n");
  try {
    const result = await server.server.elicitInput(
      {
        message:
          `To answer this, I need to search the public web for:\n${tasks}\n\n` +
          "Values from your company documents (for example an amount) may be sent to the web search service. Allow?",
        requestedSchema: {
          type: "object",
          properties: {
            approve: {
              type: "boolean",
              title: "Allow web search",
              default: false,
            },
          },
          required: ["approve"],
        },
      },
      { relatedRequestId: extra.requestId, timeout: 5 * 60_000 },
    );
    return result.action === "accept" && result.content?.approve === true;
  } catch {
    return null; // client error or no answer in 5 minutes
  }
}

async function runSearch({ question, documentId, user, extra, server }) {
  // 1. Same safety check as the chat
  if ((await aiService.checkMaliciousIntent(question)) === "MALICIOUS") {
    return fail("This request was blocked by the safety check.");
  }

  // 2. Which documents may be searched (same rule as askQuestion)
  let allowedDocumentIds;
  if (documentId) {
    if (!(await canAccessDocument(user, documentId))) return fail(NOT_FOUND);
    allowedDocumentIds = [documentId];
  } else {
    allowedDocumentIds = await getAccessibleDocumentIds(user);
  }
  if (!allowedDocumentIds.length)
    return fail("You do not have access to any documents.");

  // 3. Run CRAG
  const threadId = randomUUID();
  const config = {
    configurable: { thread_id: threadId, onEvent: createProgressSender(extra) },
  };
  try {
    let state = await cragPipeline.invoke(
      {
        question,
        documents: [],
        loopCount: 0,
        documentId: documentId ?? null,
        userId: user.id,
        allowedDocumentIds,
        historyText: "",
      },
      config,
    );

    // 4. Paused for web approval? No Allow button here, so continue with "Skip".
    // 4. Paused for web approval: ask the human through the client.
    let note = "";
    if (state?.__interrupt__?.length) {
      const pause = state.__interrupt__[0].value; // { question, webHops } from ask_approval
      const approved = await askWebApproval(server, pause, extra);

      state = await cragPipeline.invoke(
        new Command({ resume: { approved: approved === true } }),
        config,
      );

      if (approved === null) {
        note =
          "\n\n(Note: this needs a web search, but your app cannot ask for approval, so it was skipped. The answer uses company documents only.)";
      } else if (!approved) {
        note =
          "\n\n(Note: you declined the web search. The answer uses company documents only.)";
      }
    }

    const answer = state?.generation?.trim();
    if (!answer) return fail("No answer could be found in your documents.");
    return text(answer + formatSources(state.citations) + note);
  } finally {
    // 5. Checkpoints are only needed while paused, so always clean up.
    await checkpointer.deleteThread(threadId).catch(() => {});
  }
}

export function buildMcpServer(user) {
  const server = new McpServer({ name: "ai-rag-documents", version: "1.0.0" });

  server.registerTool(
    "list_my_documents",
    {
      title: "List my documents",
      description:
        "List the documents this user may read: id, file name, upload date and status. Use the id with the other tools.",
      inputSchema: {}, // this tool needs no arguments
      annotations: { readOnlyHint: true },
    },
    async () => {
      const docs = await documentService.getUserDocuments(user);
      if (!docs.length) return text("You do not have access to any documents.");

      const lines = docs.map(
        (d) =>
          `- ${d.filename} | id: ${d.id} | uploaded: ${d.createdAt.toISOString().slice(0, 10)} | status: ${d.status}`,
      );
      return text(lines.join("\n"));
    },
  );

  server.registerTool(
    "get_summary",
    {
      title: "Get document summary",
      description:
        "Get the short summary of one document. Use it to see what a document is about before searching it.",
      inputSchema: {
        documentId: z
          .string()
          .uuid()
          .describe("Document id from list_my_documents"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ documentId }) => {
      if (!(await canAccessDocument(user, documentId))) return fail(NOT_FOUND);

      const doc = await documentRepository.getDocumentById(documentId);
      if (!doc.summary) {
        return fail(`No summary yet (summary status: ${doc.summaryStatus}).`);
      }
      return text(`${doc.filename}\n\n${doc.summary}`);
    },
  );

  server.registerTool(
    "get_page",
    {
      title: "Get document page",
      description:
        "Get the full text of one page of a document. Use it to read the page a source points to, or to check exact wording.",
      inputSchema: {
        documentId: z
          .string()
          .uuid()
          .describe("Document id from list_my_documents"),
        page: z.number().int().min(1).describe("Page number, starting at 1"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ documentId, page }) => {
      if (!(await canAccessDocument(user, documentId))) return fail(NOT_FOUND);

      const chunks = await chatRepository.getChunksByPage(documentId, page);
      if (!chunks.length) return fail(`Page ${page} has no text.`);

      return text(`Page ${page}\n\n${chunks.map((c) => c.text).join("\n\n")}`);
    },
  );

  server.registerTool(
    "search_documents",
    {
      title: "Search company documents",
      description:
        "Answer a question from the company documents this user may read. Returns the answer with its sources (document and page). Use it for any question about company policies, contracts, reports or records. Pass documentId to search one document only.",
      inputSchema: {
        question: z.string().min(1).describe("The question, in plain words"),
        documentId: z
          .string()
          .uuid()
          .optional()
          .describe(
            "Optional: search only this document (from list_my_documents)",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ question, documentId }, extra) =>
      runSearch({ question, documentId, user, extra, server }),
  );

  return server;
}
