import assert from "node:assert/strict";
import { test } from "node:test";

process.env.RAG_DEBUG = "false";
process.env.LANGSMITH_TRACING = "false";
process.env.LANGCHAIN_TRACING_V2 = "false";
const { createCragPipeline } = await import("../src/services/crag.service.js");
const question = "The risk tied to Dawn's critical-path step has an owner. Who does that owner report to, and which Board committee does that boss sit on?";
const rootQuery = "Dawn critical path risk owner";
const bossQuery = "Kavita Menon reporting line";
const committeeQuery = "Example Boss Board committee membership";
// The boss and committee below are deliberately fictional test values.
const plan = [
  { id: "h1", task: "Find the risk owner for Dawn's critical step", dependsOn: [] },
  { id: "h2", task: "Find who that owner reports to", dependsOn: ["h1"] },
  { id: "h3", task: "Find that boss's Board committee", dependsOn: ["h2"] },
];
const doc = (id, text, page) => ({ id, text, searchText: text, documentId: "doc", fileUrl: "example.pdf",
  metadata: { page_number: page, source_pages: [page], chunk_index: page, document_title: "Test report", heading_path: ["Section"] } });
const documents = [
  doc("owner", "Dawn's critical step is energisation. Risk R1 has owner Kavita Menon.", 18),
  doc("boss", "Kavita Menon reports to Example Boss.", 5),
  doc("committee", "Example Boss sits on the Example Committee.", 6),
];
const result = (index) => ({
  hopId: "h" + (index + 1), status: "resolved",
  value: ["Kavita Menon", "Example Boss", "Example Committee"][index],
  inputBindings: index ? { ["h" + index]: ["Kavita Menon", "Example Boss"][index - 1] } : {},
  evidence: [{ chunkId: documents[index].id, quote: documents[index].text }],
});
const response = (value, json = true) => ({ model: "mock", choices: [{ message: { content: json ? JSON.stringify(value) : value } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });

function harness(options = {}) {
  const events = [];
  const searched = [];
  const gradingInputs = [];
  const generationInputs = [];
  let planningCalls = 0;
  let gradeCalls = 0;
  let rewriteCalls = 0;
  const pipeline = createCragPipeline({
    limits: { MAX_CRAG_LOOPS: 6, ...options.limits },
    aiService: { getEmbedding: async () => [0], rerankChunks: async (_, chunks) => chunks },
    chatRepository: {
      searchSingleDocument: async (_, __, query) => {
        const index = searched.length;
        searched.push(query);
        return options.search ? options.search(query, index) : [documents[index]];
      },
      searchAllUserDocuments: async () => { throw new Error("Unexpected cross-document search"); },
      getParentNeighbors: async (chunks) => chunks,
      getDocumentSummaryState: async () => options.summaryState || ({ summary: "A saved summary", summaryStatus: "COMPLETED", status: "COMPLETED" }),
      getChunksByPage: async () => [documents[1]],
    },
    generateReasoningChain: async () => ({ summary: "Non-search answer", steps: [] }),
    chatCompletion: async (_, request) => {
      const prompt = request.messages[0].content;
      if (prompt.includes("intent classifier")) return response({ intent: options.intent || "search", page_number: options.intent === "page" ? 5 : null });
      if (prompt.includes("search query planner")) {
        const call = planningCalls++;
        return options.planner ? options.planner(call) : response({ queries: options.queries || [rootQuery], hops: options.plan || plan });
      }
      if (prompt.includes("document evidence grader")) {
        const input = JSON.parse(request.messages[1].content);
        gradingInputs.push(input);
        const index = gradeCalls++;
        if (options.grade) return options.grade(input, index);
        return response({ relevant_chunk_ids: [], hops: [result(index)],
          next_query: index === 0 ? { hopId: "h2", query: bossQuery } : index === 1 ? { hopId: "h3", query: committeeQuery } : null });
      }
      if (prompt.includes("follow-up search planner")) {
        const index = rewriteCalls++;
        return response(options.rewrite ? options.rewrite(index) : "Alternative search for missing evidence", false);
      }
      generationInputs.push(request);
      return response("Mock answer from the supplied evidence.", false);
    },
  });
  return {
    events, searched, gradingInputs, generationInputs,
    planningCalls: () => planningCalls,
    run: () => pipeline.invoke({ question, documentId: "doc", userId: "user", documents: [], loopCount: 0, historyText: "" },
      { configurable: { onEvent: (event) => events.push(event) }, recursionLimit: 50 }),
  };
}

test("the real graph executes owner -> boss -> committee before generating", async () => {
  const h = harness();
  const final = await h.run();
  assert.deepEqual(h.searched, [rootQuery, bossQuery, committeeQuery]);
  assert.equal(final.isComplete, true);
  assert.equal(final.stopReason, "complete");
  assert.equal(final.loopCount, 3);
  assert.equal(h.generationInputs.length, 1);
  assert.equal(final.reasoningChain.steps.filter((step) => step.type === "multi_hop_search").length, 2);
  assert.deepEqual(final.reasoningChain.searchRounds.map((round) => round.queries[0]), h.searched);
  assert.equal(h.gradingInputs[1].previousProgress[0].value, "Kavita Menon");
  assert.ok(h.gradingInputs[2].chunks.some((chunk) => chunk.id === "owner"));
  assert.ok(h.gradingInputs[2].chunks.some((chunk) => chunk.id === "boss"));
  assert.deepEqual(new Set(final.citations.map((citation) => citation.chunkId)), new Set(documents.map((item) => item.id)));
  const grades = h.events.filter((event) => event.type === "grading_result");
  assert.equal(grades[0].isComplete, false);
  assert.equal(grades[0].missingQuery, bossQuery);
  assert.equal(grades[0].hopProgress[1].status, "pending");
  assert.equal(grades[2].stopReason, "complete");
});

test("full first-round evidence does not force unnecessary searches", async () => {
  const h = harness({ search: () => documents, grade: () => response({ relevant_chunk_ids: [], hops: [result(0), result(1), result(2)], next_query: null }) });
  assert.equal((await h.run()).isComplete, true);
  assert.equal(h.searched.length, 1);
});

test("a grader exception cannot complete the question and its candidates remain unverified", async () => {
  const h = harness({
    search: () => [documents[0]],
    grade: () => { throw new Error("Mock grader failure"); },
    rewrite: () => bossQuery,
  });
  const final = await h.run();
  assert.equal(final.isComplete, false);
  assert.equal(final.stopReason, "no_progress");
  assert.equal(h.searched.length, 2);
  assert.ok(h.events.filter((event) => event.type === "grading_result").every((event) =>
    event.decisionSource === "grader_error_fallback" && !event.isComplete));
});

test("invented evidence is rejected and a repeated follow-up is not executed twice", async () => {
  const h = harness({
    search: () => [documents[0]],
    grade: () => response({ relevant_chunk_ids: ["owner"], hops: [{ ...result(0), evidence: [{ chunkId: "owner", quote: "An invented relationship that does not occur." }] }],
      next_query: { hopId: "h1", query: rootQuery } }),
    rewrite: () => rootQuery,
  });
  const final = await h.run();
  assert.equal(final.isComplete, false);
  assert.equal(final.stopReason, "no_new_query");
  assert.deepEqual(h.searched, [rootQuery]);
  assert.equal(final.hopProgress[0].reason, "quote_not_found");
  assert.equal(h.events.find((event) => event.type === "grading_result").hopProgress[0].reason, "quote_not_found");
});

test("round budget reports unresolved relationships instead of claiming completion", async () => {
  const h = harness({ limits: { MAX_CRAG_LOOPS: 1 } });
  const final = await h.run();
  assert.equal(final.isComplete, false);
  assert.equal(final.stopReason, "round_limit");
  assert.equal(h.searched.length, 1);
  assert.equal(final.reasoningChain.steps.filter((step) => step.type === "multi_hop_search").length, 0);
  assert.ok(h.generationInputs[0].messages[0].content.includes("round_limit"));
});

test("generation prioritizes supporting sources and reports evidence lost to context limits", async () => {
  const noise = doc("noise", "Earlier irrelevant material", 1);
  const grade = () => response({ relevant_chunk_ids: ["noise"], hops: [result(0), result(1), result(2)], next_query: null });
  const protectedRun = harness({ search: () => [noise, ...documents], grade, limits: { MAX_CONTEXT_CHUNKS: 3 } });
  assert.equal((await protectedRun.run()).isComplete, true);
  assert.ok(!protectedRun.events.find((event) => event.type === "generation_context").documents.some((item) => item.id === "noise"));
  const limited = harness({ search: () => [noise, ...documents], grade, limits: { MAX_CONTEXT_CHUNKS: 2 } });
  const final = await limited.run();
  assert.equal(final.isComplete, false);
  assert.equal(final.stopReason, "context_limit");
  assert.equal(final.hopProgress[2].status, "pending");
  assert.equal(limited.events.find((event) => event.type === "generation_context").contextLimited, true);
});

test("an invalid plan retries once then stops without retrieving or inventing a plan", async () => {
  const h = harness({ planner: () => response({ queries: [rootQuery], hops: [] }) });
  const final = await h.run();
  assert.equal(h.planningCalls(), 2);
  assert.equal(final.stopReason, "planning_failed");
  assert.equal(final.isComplete, false);
  assert.equal(h.searched.length, 0);
  assert.equal(h.generationInputs.length, 0);
});

test("a valid second planning attempt recovers normally", async () => {
  const h = harness({ planner: (index) => response({ queries: [rootQuery], hops: index ? plan : [] }) });
  assert.equal((await h.run()).isComplete, true);
  assert.equal(h.planningCalls(), 2);
});

test("single-fact and independent questions complete without a forced chain", async () => {
  const single = harness({ plan: [plan[0]], grade: () => response({ relevant_chunk_ids: [], hops: [result(0)], next_query: null }) });
  assert.equal((await single.run()).isComplete, true);
  const independent = harness({
    plan: [plan[0], { ...plan[1], dependsOn: [] }], queries: [rootQuery, bossQuery],
    search: (query) => [query === rootQuery ? documents[0] : documents[1]],
    grade: () => response({ relevant_chunk_ids: [], hops: [result(0), { ...result(1), inputBindings: {} }], next_query: null }),
  });
  const final = await independent.run();
  assert.equal(final.isComplete, true);
  assert.equal(final.loopCount, 1);
  assert.deepEqual(new Set(independent.searched), new Set([rootQuery, bossQuery]));
});

test("a greeting skips planning and retrieval", async () => {
  const h = harness({ intent: "greeting" });
  assert.equal((await h.run()).generation, "Mock answer from the supplied evidence.");
  assert.equal(h.planningCalls(), 0);
  assert.equal(h.searched.length, 0);
});

test("a ready summary retains its existing lookup and generation path", async () => {
  const h = harness({ intent: "summary" });
  const final = await h.run();
  assert.equal(final.generation, "Mock answer from the supplied evidence.");
  assert.equal(h.planningCalls(), 0);
  assert.equal(h.searched.length, 0);
  assert.ok(h.generationInputs[0].messages[0].content.includes("A saved summary"));
});

test("an unfinished summary returns its readiness message without generation", async () => {
  const h = harness({ intent: "summary", summaryState: { summaryStatus: "PROCESSING", summary: null } });
  const final = await h.run();
  assert.match(final.generation, /summary is still processing/);
  assert.equal(h.generationInputs.length, 0);
  assert.equal(h.searched.length, 0);
});

test("page lookup retains its existing route without a dependency plan", async () => {
  const h = harness({ intent: "page" });
  const final = await h.run();
  assert.equal(final.generation, "Mock answer from the supplied evidence.");
  assert.equal(h.planningCalls(), 0);
  assert.equal(h.searched.length, 0);
  assert.equal(final.citations[0].pageNumber, 5);
});

test("no retrieved evidence remains incomplete and bounded", async () => {
  const h = harness({ search: () => [], rewrite: () => "Alternative project risk query" });
  const final = await h.run();
  assert.equal(final.isComplete, false);
  assert.equal(final.stopReason, "no_progress");
  assert.equal(h.searched.length, 2);
  assert.equal(h.gradingInputs.length, 0);
  assert.ok(h.events.filter((event) => event.type === "grading_result").every((event) => event.decisionSource === "no_evidence"));
});

test("a repeated grader proposal is rewritten into a fresh targeted query", async () => {
  const h = harness({
    grade: (_, index) => response({ relevant_chunk_ids: [], hops: [result(index)],
      next_query: index === 0 ? { hopId: "h2", query: rootQuery } : index === 1 ? { hopId: "h3", query: committeeQuery } : null }),
    rewrite: () => bossQuery,
  });
  assert.equal((await h.run()).isComplete, true);
  assert.deepEqual(h.searched, [rootQuery, bossQuery, committeeQuery]);
});

test("malformed grading JSON is not treated as completeness", async () => {
  const h = harness({
    grade: () => response("invalid JSON", false),
    search: () => [documents[0]], rewrite: () => bossQuery,
  });
  assert.equal((await h.run()).isComplete, false);
  assert.equal(h.events.find((event) => event.type === "grading_result").decisionSource, "grader_error_fallback");
});

test("a failed query rewriter stops without replaying the original query", async () => {
  const h = harness({
    grade: () => response({ relevant_chunk_ids: ["owner"], hops: [result(0)], next_query: null }),
    rewrite: () => { throw new Error("Mock rewriter failure"); },
  });
  const final = await h.run();
  assert.equal(final.stopReason, "query_planning_failed");
  assert.equal(final.isComplete, false);
  assert.deepEqual(h.searched, [rootQuery]);
  const event = h.events.find((item) => item.tool === "Query Rewriter" && item.type === "tool_finish");
  assert.equal(event.planningError.message, "Mock rewriter failure");
  assert.equal(event.pipelineVersion, "hop-evidence-v2");
});

test("pending records with omitted fields preserve owner evidence and allow the next search", async () => {
  const h = harness({ grade: (_, index) => response({ relevant_chunk_ids: [], hops: [result(index),
    ...(index === 0 ? [{ hopId: "h2", status: "pending", value: null }, { hopId: "h3", status: "pending" }] : []),
  ], next_query: index === 0 ? { hopId: "h2", query: bossQuery } : index === 1 ? { hopId: "h3", query: committeeQuery } : null }) });
  assert.equal((await h.run()).isComplete, true);
  assert.deepEqual(h.searched, [rootQuery, bossQuery, committeeQuery]);
  const event = h.events.find((item) => item.tool === "Relevance Grader" && item.type === "tool_finish");
  assert.equal(event.hopProgress[0].value, "Kavita Menon");
  assert.equal(event.pipelineVersion, "hop-evidence-v2");
});

test("an empty rewriter response is diagnosed instead of silently labelled as no new query", async () => {
  const h = harness({ grade: () => response({ relevant_chunk_ids: ["owner"], hops: [result(0)], next_query: null }), rewrite: () => "" });
  const final = await h.run();
  assert.equal(final.stopReason, "query_planning_failed");
  const event = h.events.find((item) => item.tool === "Query Rewriter" && item.type === "tool_finish");
  assert.equal(event.planningError.code, "empty_model_response");
  assert.equal(event.planningError.hasAnswerContent, false);
});

test("provider failures appear directly in the grader tool event", async () => {
  const h = harness({ grade: () => { throw Object.assign(new Error("Mock provider limit"), { status: 429, code: "rate_limit" }); }, search: () => [documents[0]] });
  await h.run();
  const event = h.events.find((item) => item.tool === "Relevance Grader" && item.type === "tool_finish");
  assert.equal(event.gradingError.status, 429);
  assert.equal(event.gradingError.code, "rate_limit");
  assert.equal(event.decisionSource, "grader_error_fallback");
});
