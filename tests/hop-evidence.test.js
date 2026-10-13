import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateHopPlan, validateGradeResponse, updateHopProgress, isPlanComplete,
  nextPendingHop, chooseFollowUp, progressDecision, selectEvidenceContext,
  mergeSearchRounds, buildHopReasoningChain,
  readModelContent, modelFailureDetails,
} from "../src/services/hop-evidence.service.js";

const plan = [
  { id: "h1", task: "Find the risk owner", dependsOn: [] },
  { id: "h2", task: "Find that owner's boss", dependsOn: ["h1"] },
  { id: "h3", task: "Find that boss's committee", dependsOn: ["h2"] },
];
const docs = [
  { id: "owner", text: "Risk R1 owner is Kavita Menon.", documentId: "doc", metadata: { chunk_index: 18 } },
  { id: "boss", text: "Kavita Menon reports to Example Boss.", documentId: "doc", metadata: { chunk_index: 5 } },
  { id: "committee", text: "Example Boss sits on the Example Committee.", documentId: "doc", metadata: { chunk_index: 6 } },
];
const results = [
  { hopId: "h1", status: "resolved", value: "Kavita Menon", inputBindings: {}, evidence: [{ chunkId: "owner", quote: docs[0].text }] },
  { hopId: "h2", status: "resolved", value: "Example Boss", inputBindings: { h1: "Kavita Menon" }, evidence: [{ chunkId: "boss", quote: docs[1].text }] },
  { hopId: "h3", status: "resolved", value: "Example Committee", inputBindings: { h2: "Example Boss" }, evidence: [{ chunkId: "committee", quote: docs[2].text }] },
];
const complete = updateHopProgress(plan, [], results, docs);

test("plans reject empty tasks, duplicate IDs, cycles, and forward references", () => {
  assert.deepEqual(validateHopPlan(plan), plan);
  for (const invalid of [[], [plan[0], plan[0]], [plan[1], plan[0]], [{ ...plan[0], task: "" }], [{ ...plan[0], dependsOn: ["h1"] }]]) {
    assert.throws(() => validateHopPlan(invalid));
  }
});

test("an owner alone leaves the boss and committee tasks pending", () => {
  const progress = updateHopProgress(plan, [], [results[0]], [docs[0]]);
  assert.equal(isPlanComplete(plan, progress), false);
  assert.equal(nextPendingHop(plan, progress).id, "h2");
  assert.equal(progress[2].status, "pending");
  assert.equal(isPlanComplete([], []), false);
});

test("all dependent tasks may resolve in one round when all evidence is present", () => {
  assert.equal(isPlanComplete(plan, complete), true);
  assert.equal(nextPendingHop(plan, complete), null);
});

test("wrong entity bindings invalidate the reporting line and dependent committee", () => {
  const wrong = { ...results[1], inputBindings: { h1: "Another Owner" } };
  const progress = updateHopProgress(plan, [], [results[0], wrong, results[2]], docs);
  assert.equal(progress[1].reason, "invalid_binding");
  assert.equal(progress[2].reason, "unresolved_dependency");
});

test("unknown chunks, invented quotes and absent evidence cannot resolve a task", () => {
  for (const evidence of [[], [{ chunkId: "unknown", quote: docs[0].text }], [{ chunkId: "owner", quote: "A passage that was never retrieved." }]]) {
    const progress = updateHopProgress(plan, [], [{ ...results[0], evidence }], docs);
    assert.equal(progress[0].status, "pending");
  }
  const spaced = [{ ...docs[0], text: "Risk R1 owner\n is Kavita Menon." }];
  assert.equal(updateHopProgress(plan, [], [results[0]], spaced)[0].status, "resolved");
});

test("earlier accepted facts survive subsequent grading and dependency revisions invalidate descendants", () => {
  const prior = updateHopProgress(plan, [], [results[0]], docs);
  assert.equal(updateHopProgress(plan, prior, [results[1]], docs)[0].value, "Kavita Menon");
  const changedDocs = [{ ...docs[0], text: "Risk R1 owner is Another Owner." }, ...docs.slice(1)];
  const changed = { ...results[0], value: "Another Owner", evidence: [{ chunkId: "owner", quote: changedDocs[0].text }] };
  const progress = updateHopProgress(plan, complete, [changed], changedDocs);
  assert.equal(progress[0].status, "resolved");
  assert.equal(progress[1].status, "pending");
  assert.equal(progress[2].status, "pending");
});

test("grader payload keeps valid tasks while invalid task records remain unverified", () => {
  const payload = { relevant_chunk_ids: ["owner"], hops: [results[0]] };
  assert.deepEqual(validateGradeResponse(payload, plan, docs).hops, payload.hops);
  assert.throws(() => validateGradeResponse(null, plan, docs));
  const unknown = validateGradeResponse({ ...payload, relevant_chunk_ids: ["unknown"], hops: [results[0], { ...results[1], hopId: "unknown" }] }, plan, docs);
  assert.deepEqual(unknown.relevant_chunk_ids, []);
  assert.deepEqual(unknown.hops, [results[0]]);
  assert.equal(unknown.validationWarnings.length, 2);
  const duplicate = validateGradeResponse({ ...payload, hops: [results[0], results[0]] }, plan, docs);
  assert.equal(duplicate.hops[0].status, "pending");
  assert.equal(duplicate.hops[0].reason, "duplicate_task_result");
});

test("an incomplete pending record cannot discard a valid owner result", () => {
  const parsed = validateGradeResponse({ relevant_chunk_ids: ["owner"], hops: [
    results[0], { hopId: "h2", status: "pending", value: null },
    { hopId: "h3", status: "resolved", value: "Invented", evidence: [] },
  ] }, plan, docs);
  const progress = updateHopProgress(plan, [], parsed.hops, docs);
  assert.equal(progress[0].status, "resolved");
  assert.equal(progress[0].value, "Kavita Menon");
  assert.equal(progress[1].status, "pending");
  assert.equal(progress[2].reason, "invalid_task_result");
  assert.equal(isPlanComplete(plan, progress), false);
});

test("empty, reasoning-only and truncated responses have explicit diagnostics", () => {
  for (const response of [null, {}, { choices: [{ message: { content: "", reasoning: "private analysis" }, finish_reason: "stop" }] }]) {
    assert.throws(() => readModelContent(response), { code: "empty_model_response" });
  }
  assert.throws(() => readModelContent({ choices: [{ message: { content: "partial" }, finish_reason: "length" }] }), { code: "incomplete_model_response" });
  assert.equal(readModelContent({ choices: [{ message: { content: "answer" }, finish_reason: "stop" }] }), "answer");
  const details = modelFailureDetails(Object.assign(new Error("Provider limit reached"), { status: 429, code: "rate_limit", request_id: "request-1" }), null);
  assert.equal(details.status, 429);
  assert.equal(details.code, "rate_limit");
  assert.equal(details.message, "Provider limit reached");
  assert.equal(details.hasAnswerContent, false);
});

test("follow-up selection targets an eligible task and rejects repeated queries", () => {
  const progress = updateHopProgress(plan, [], [results[0]], docs);
  assert.equal(chooseFollowUp(plan, progress, { hopId: "h2", query: "Kavita Menon reporting line" }, []), "Kavita Menon reporting line");
  assert.equal(chooseFollowUp(plan, progress, { hopId: "h3", query: "Committee membership" }, []), "");
  assert.equal(chooseFollowUp(plan, progress, { hopId: "h2", query: " kavita   menon reporting line " }, ["Kavita Menon reporting line"]), "");
});

test("grading errors never imply completeness and loops stop on budget or stalled tasks", () => {
  const base = { plan, previous: [], progress: complete, round: 1, maxRounds: 3, noProgressRounds: 0 };
  assert.equal(progressDecision({ ...base, gradingSucceeded: false }).isComplete, false);
  assert.equal(progressDecision({ ...base, gradingSucceeded: true }).stopReason, "complete");
  assert.equal(progressDecision({ ...base, progress: [], round: 3, gradingSucceeded: true }).stopReason, "round_limit");
  assert.equal(progressDecision({ ...base, progress: [], noProgressRounds: 1, gradingSucceeded: true }).stopReason, "no_progress");
  assert.equal(progressDecision({ ...base, previous: complete, progress: complete, round: 3, gradingSucceeded: true }).stopReason, "complete");
});

test("context selection protects supporting chunks before earlier irrelevant chunks", () => {
  const noise = { id: "noise", text: "Unrelated earlier material", documentId: "doc", metadata: { chunk_index: 1 } };
  const selected = selectEvidenceContext([noise, ...docs], complete, { maxChunks: 3, maxChars: 500, renderDocument: (doc) => doc.text });
  assert.deepEqual(new Set(selected.map((doc) => doc.id)), new Set(docs.map((doc) => doc.id)));
  assert.equal(isPlanComplete(plan, updateHopProgress(plan, complete, [], selected)), true);
});

test("context limits downgrade missing evidence and whole multi-chunk bundles do not partially enter context", () => {
  const selected = selectEvidenceContext(docs, complete, { maxChunks: 2, maxChars: 500, renderDocument: (doc) => doc.text });
  assert.equal(isPlanComplete(plan, updateHopProgress(plan, complete, [], selected)), false);
  const bundle = [{ ...results[0], evidence: [results[0].evidence[0], results[1].evidence[0]] }];
  assert.deepEqual(selectEvidenceContext(docs.slice(0, 2), bundle, { maxChunks: 1, maxChars: 500, renderDocument: (doc) => doc.text }), []);
  assert.deepEqual(selectEvidenceContext(docs, complete, { maxChunks: 3, maxChars: 5, renderDocument: (doc) => doc.text }), []);
});

test("context budget includes source wrappers and separators", () => {
  const renderDocument = (doc) => `<source>${doc.text}</source>`;
  const selected = selectEvidenceContext(docs, complete, { maxChunks: 3, maxChars: 100, renderDocument });
  assert.ok(selected.map(renderDocument).join("\n\n---\n\n").length <= 100);
});

test("single facts and independent tasks have no artificial sequential dependency", () => {
  const independent = [{ ...plan[0] }, { ...plan[1], dependsOn: [] }];
  const progress = updateHopProgress(independent, [], [results[0], { ...results[1], inputBindings: {} }], docs);
  assert.equal(isPlanComplete(independent, progress), true);
  assert.equal(isPlanComplete([plan[0]], [complete[0]]), true);
});

test("reasoning reports only searches actually executed, including their stopping reason", () => {
  const rounds = mergeSearchRounds([{ attempt: 1, queries: ["owner"], retrievedParentIds: ["owner"] }], [{ attempt: 1, hopProgress: [complete[0]], missingQuery: "unexecuted follow-up" }]);
  const trace = buildHopReasoningChain(plan, [complete[0]], rounds, "round_limit");
  assert.equal(trace.steps.filter((step) => step.type === "multi_hop_search").length, 0);
  assert.equal(trace.stopReason, "round_limit");
  assert.deepEqual(trace.searchRounds[0].retrievedParentIds, ["owner"]);
});
