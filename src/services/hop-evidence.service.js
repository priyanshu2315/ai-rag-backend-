// These checks establish provenance and dependency consistency. The grader
// still decides whether a cited passage semantically answers the whole task.
export const normalizeText = (text) =>
  String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
export const queryKey = (query) => normalizeText(query).toLowerCase();

// A search query must be one short line; answers, tables and explanations are rejected
const MAX_QUERY_CHARS = 150;
const MAX_QUERY_WORDS = 20;
export const cleanSearchQuery = (raw) => {
  const lines = String(raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length !== 1) return "";

  const query = lines[0]
    .replace(/^(search query|query)\s*:\s*/i, "") // "Query: ..." -> "..."
    .replace(/^["'`]+|["'`]+$/g, "") // strip wrapping quotes
    .trim();

  if (
    query.includes("|") ||
    query.length > MAX_QUERY_CHARS ||
    query.split(/\s+/).length > MAX_QUERY_WORDS
  )
    return "";

  return query;
};

const toList = (value) =>
  Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];

// Turns a grader or rewriter reply into the same { text, keywords, identifiers, entities }
// shape the planner returns. The AI fills the lists; code only cleans them.
// Returns null when text is not a valid one-line search phrase.
export const toSearchQuery = (input) => {
  const isObject = typeof input === "object" && input !== null;
  const text = cleanSearchQuery(isObject ? (input.text ?? input.query) : input);
  if (text.length < 4) return null;
  return {
    text,
    keywords: isObject ? toList(input.keywords) : [],
    identifiers: isObject ? toList(input.identifiers) : [],
    entities: isObject ? toList(input.entities) : [],
  };
};

export function validateHopPlan(plan) {
  if (!Array.isArray(plan) || !plan.length || plan.length > 12) {
    throw new Error("Expected between one and twelve question tasks");
  }
  const seen = new Set();
  return plan.map((hop) => {
    if (
      !hop ||
      typeof hop.id !== "string" ||
      !hop.id.trim() ||
      seen.has(hop.id) ||
      typeof hop.task !== "string" ||
      !hop.task.trim() ||
      !Array.isArray(hop.dependsOn) ||
      hop.dependsOn.some((id) => !seen.has(id)) ||
      new Set(hop.dependsOn).size !== hop.dependsOn.length
    ) {
      throw new Error("Invalid or unordered question dependency plan");
    }
    seen.add(hop.id);
    return { id: hop.id, task: hop.task.trim(), dependsOn: [...hop.dependsOn] };
  });
}

export function uniqueDocuments(documents) {
  return [...new Map(documents.map((doc) => [doc.id, doc])).values()];
}

export function evidenceIds(progress) {
  return new Set(
    progress
      .filter((hop) => hop.status === "resolved")
      .flatMap((hop) => hop.evidence.map((item) => item.chunkId)),
  );
}

export function validateGradeResponse(parsed, plan, documents) {
  if (
    !parsed ||
    !Array.isArray(parsed.relevant_chunk_ids) ||
    !Array.isArray(parsed.hops)
  ) {
    throw new Error("Grader must return relevant_chunk_ids and hops arrays");
  }
  const documentIds = new Set(documents.map((doc) => doc.id));
  const hopIds = new Set(plan.map((hop) => hop.id));
  const updates = new Map();
  const validationWarnings = [];
  const relevantIds = parsed.relevant_chunk_ids.filter((id) =>
    documentIds.has(id),
  );
  if (relevantIds.length !== parsed.relevant_chunk_ids.length) {
    validationWarnings.push("Unknown relevance chunk IDs were ignored");
  }
  for (const update of parsed.hops) {
    if (!update || !hopIds.has(update.hopId)) {
      validationWarnings.push("An unknown task result was ignored");
      continue;
    }
    const pending = (reason) => ({
      hopId: update.hopId,
      status: "pending",
      value: "",
      inputBindings: {},
      evidence: [],
      reason,
    });
    if (updates.has(update.hopId)) {
      updates.set(update.hopId, pending("duplicate_task_result"));
      validationWarnings.push(
        `Duplicate result for ${update.hopId} remains pending`,
      );
    } else if (update.status === "pending") {
      // Unresolved tasks do not need invented values, bindings or evidence.
      updates.set(update.hopId, pending("not_resolved"));
    } else if (
      update.status !== "resolved" ||
      typeof update.value !== "string" ||
      !update.inputBindings ||
      typeof update.inputBindings !== "object" ||
      Array.isArray(update.inputBindings) ||
      !Array.isArray(update.evidence)
    ) {
      updates.set(update.hopId, pending("invalid_task_result"));
      validationWarnings.push(
        `Invalid result for ${update.hopId} remains pending`,
      );
    } else {
      updates.set(update.hopId, update);
    }
  }
  return {
    ...parsed,
    relevant_chunk_ids: [...new Set(relevantIds)],
    hops: [...updates.values()],
    validationWarnings,
  };
}

// Read only answer content. Empty/reasoning-only/truncated responses are not answers.
export function readModelContent(response) {
  const choice = response?.choices?.[0];
  if (
    !response ||
    !choice ||
    typeof choice.message?.content !== "string" ||
    !choice.message.content.trim()
  ) {
    const error = new Error("The model returned no usable answer content");
    error.code = "empty_model_response";
    throw error;
  }
  if (choice.finish_reason && choice.finish_reason !== "stop") {
    const error = new Error(
      `The model response did not finish normally (${choice.finish_reason})`,
    );
    error.code = "incomplete_model_response";
    throw error;
  }
  return choice.message.content;
}

export function modelFailureDetails(error, response) {
  return {
    message: String(error?.message || "Unknown model response failure").slice(
      0,
      1000,
    ),
    code: error?.code ?? error?.error?.code ?? null,
    status: error?.status ?? null,
    requestId: error?.request_id ?? null,
    model: response?.model ?? null,
    finishReason: response?.choices?.[0]?.finish_reason ?? null,
    hasAnswerContent:
      typeof response?.choices?.[0]?.message?.content === "string" &&
      response.choices[0].message.content.trim().length > 0,
  };
}

// Words for the in-order check: lowercase, Markdown marks dropped; codes and numbers such as
// "FIN-AAM-02" and "10,001" stay one word.
const quoteWords = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[*#|_`>]/g, " ")
    .match(/[a-z0-9]+(?:[.,'-][a-z0-9]+)*/g) || [];

// All words of a quote piece appear in the chunk in the same order, within a short span
// (twice the piece length plus 20 words). Skipping a table line or Markdown passes;
// words picked from all over the chunk, or a changed number or name, do not.
const wordsInOrder = (piece, textWords) => {
  const q = quoteWords(piece);
  for (let start = 0; start < textWords.length; start++) {
    if (textWords[start] !== q[0]) continue;
    const maxEnd = start + q.length * 2 + 20;
    let qi = 1;
    for (
      let ti = start + 1;
      qi < q.length && ti < textWords.length && ti < maxEnd;
      ti++
    ) {
      if (textWords[ti] === q[qi]) qi++;
    }
    if (qi === q.length) return true;
  }
  return false;
};

export const isQuoteInDocText = (quote, text) => {
  const normText = normalizeText(text).toLowerCase();
  const normQuote = normalizeText(quote).toLowerCase();
  if (normText.includes(normQuote)) return true;
  // Graders shorten quotes with "..." or by dropping whole lines; split on both
  // before normalizing, because normalizing turns newlines into spaces
  const parts = String(quote ?? "")
    .split(/\.{3,}|\u2026|\n/)
    .map((p) => normalizeText(p).toLowerCase())
    .filter((p) => p.length >= 4);
  if (parts.length >= 2) {
    // Accept when at least 80% of the pieces appear in the chunk in order
    let lastIndex = 0;
    let found = 0;
    for (const part of parts) {
      const idx = normText.indexOf(part, lastIndex);
      if (idx === -1) continue;
      found++;
      lastIndex = idx + part.length;
    }
    if (found / parts.length >= 0.8) return true;
  }
  // Graders also join table lines into one line or skip a line inside a quote (e.g. an
  // older-version row). Accept when every "..."-separated piece of 3+ words appears in order.
  const textWords = quoteWords(text);
  const pieces = String(quote ?? "")
    .split(/\.{3,}|\u2026/)
    .filter(
      (piece) => quoteWords(piece).length >= (quote.includes("...") ? 3 : 4),
    );
  return (
    pieces.length > 0 && pieces.every((piece) => wordsInOrder(piece, textWords))
  );
};

export function updateHopProgress(plan, previous, updates, documents) {
  const docs = new Map(documents.map((doc) => [doc.id, doc]));
  const candidates = new Map(previous.map((item) => [item.hopId, item]));
  for (const update of updates) candidates.set(update.hopId, update);
  const checked = new Map();

  for (const hop of plan) {
    const candidate = candidates.get(hop.id);
    let reason = candidate?.reason || "not_resolved";
    let validEvidence = [];

    if (candidate?.status === "resolved") {
      reason = "";
      if (typeof candidate.value !== "string" || !candidate.value.trim())
        reason = "missing_value";
      for (const dependency of hop.dependsOn) {
        const prior = checked.get(dependency);
        if (prior?.status !== "resolved") reason ||= "unresolved_dependency";
        else {
          const bindingVal = normalizeText(
            candidate.inputBindings?.[dependency],
          ).toLowerCase();

          const priorVal = normalizeText(prior.value).toLowerCase();

          const bindingMatches = Boolean(
            bindingVal &&
            priorVal &&
            (bindingVal === priorVal ||
              (bindingVal.length >= 2 && priorVal.includes(bindingVal)) ||
              (priorVal.length >= 2 && bindingVal.includes(priorVal))),
          );
          if (!bindingMatches) {
            reason ||= "invalid_binding";
          }
        }
      }
      if (!Array.isArray(candidate.evidence) || !candidate.evidence.length)
        reason ||= "missing_evidence";
      else {
        // A quote naming an unknown chunk ID (e.g. a document ID) is dropped, not fatal,
        // as long as at least one quote points to a chunk the grader was shown.
        validEvidence = candidate.evidence.filter((item) =>
          docs.has(item?.chunkId),
        );
        if (!validEvidence.length) reason ||= "missing_chunk";
        for (const item of validEvidence) {
          const doc = docs.get(item.chunkId);
          const quote = normalizeText(item?.quote);
          if (
            typeof item?.quote !== "string" ||
            quote.length < 8 ||
            !isQuoteInDocText(item.quote, doc.searchText || doc.text)
          )
            reason ||= "quote_not_found";
        }
      }
    }
    checked.set(
      hop.id,
      reason
        ? {
            hopId: hop.id,
            status: "pending",
            value: "",
            inputBindings: {},
            evidence: [],
            reason,
          }
        : {
            hopId: hop.id,
            status: "resolved",
            value: candidate.value.trim(),
            inputBindings: Object.fromEntries(
              hop.dependsOn.map((id) => [id, checked.get(id).value]),
            ),
            evidence: validEvidence.map((item) => ({
              chunkId: item.chunkId,
              quote: item.quote,
            })),
          },
    );
  }
  return [...checked.values()];
}

export function isPlanComplete(plan, progress) {
  return (
    plan.length > 0 &&
    plan.every((hop) =>
      progress.some(
        (item) => item.hopId === hop.id && item.status === "resolved",
      ),
    )
  );
}

export function nextPendingHop(plan, progress) {
  const resolved = new Set(
    progress
      .filter((item) => item.status === "resolved")
      .map((item) => item.hopId),
  );
  return (
    plan.find(
      (hop) =>
        !resolved.has(hop.id) && hop.dependsOn.every((id) => resolved.has(id)),
    ) ?? null
  );
}

export function chooseFollowUp(plan, progress, proposal, executedQueries) {
  const pending = nextPendingHop(plan, progress);
  const proposed = proposal?.text ?? proposal?.query;
  if (
    !pending ||
    proposal?.hopId !== pending.id ||
    typeof proposed !== "string"
  )
    return "";
  const query = cleanSearchQuery(proposed);
  if (
    query.length < 4 ||
    executedQueries.some((old) => queryKey(old) === queryKey(query))
  )
    return "";
  return query;
}

export function progressDecision({
  plan,
  previous,
  progress,
  round,
  maxRounds,
  noProgressRounds,
  gradingSucceeded,
}) {
  const resolved = (items) =>
    new Set(
      items.filter((hop) => hop.status === "resolved").map((hop) => hop.hopId),
    );
  const before = resolved(previous);
  const madeProgress = progress.some(
    (hop) =>
      hop.status === "resolved" &&
      (!before.has(hop.hopId) ||
        previous.find((old) => old.hopId === hop.hopId)?.value !== hop.value),
  );
  const stalled = madeProgress ? 0 : noProgressRounds + 1;
  const isComplete = gradingSucceeded && isPlanComplete(plan, progress);
  const stopReason = isComplete
    ? "complete"
    : round >= maxRounds
      ? "round_limit"
      : stalled >= 2
        ? "no_progress"
        : "";
  return { isComplete, noProgressRounds: stalled, stopReason };
}

export function mergeSearchRounds(previous, updates) {
  const rounds = new Map(previous.map((round) => [round.attempt, round]));
  for (const round of updates)
    rounds.set(round.attempt, { ...rounds.get(round.attempt), ...round });
  return [...rounds.values()].sort((a, b) => a.attempt - b.attempt);
}

// Select supporting documents in whole bundles, then add optional context.
// renderDocument accounts for the actual source wrapper, not just body length.
export function selectEvidenceContext(
  documents,
  progress,
  { maxChunks, maxChars, renderDocument },
) {
  const docs = uniqueDocuments(documents);
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  const selected = new Map();
  const separatorSize = "\n\n---\n\n".length;
  let chars = 0;
  const addBundle = (ids) => {
    const newIds = [...new Set(ids)].filter((id) => !selected.has(id));
    if (newIds.some((id) => !byId.has(id))) return false;
    const extra = newIds.reduce(
      (sum, id, index) =>
        sum +
        renderDocument(byId.get(id)).length +
        (selected.size || index ? separatorSize : 0),
      0,
    );
    if (selected.size + newIds.length > maxChunks || chars + extra > maxChars)
      return false;
    for (const id of newIds) selected.set(id, byId.get(id));
    chars += extra;
    return true;
  };
  const required = evidenceIds(progress);
  for (const hop of progress.filter((item) => item.status === "resolved")) {
    addBundle(hop.evidence.map((item) => item.chunkId));
  }
  for (const doc of docs) if (!required.has(doc.id)) addBundle([doc.id]);
  return [...selected.values()].sort(
    (a, b) =>
      (a.documentId || "").localeCompare(b.documentId || "") ||
      (a.metadata?.chunk_index ?? 0) - (b.metadata?.chunk_index ?? 0),
  );
}

export function buildHopReasoningChain(plan, progress, rounds, stopReason) {
  const resolved = progress.filter((hop) => hop.status === "resolved").length;
  const steps = rounds
    .filter((round) => round.queries?.length)
    .map((round, index) => ({
      step: index + 1,
      type: index === 0 ? "initial_search" : "multi_hop_search",
      title: `Search round ${round.attempt}`,
      description: round.queries.join(" | "),
      findings: (round.hopProgress || [])
        .map((hop) =>
          hop.status === "resolved"
            ? `${hop.hopId}: ${hop.value} (chunks: ${hop.evidence.map((item) => item.chunkId).join(", ")})`
            : `${hop.hopId}: pending (${hop.reason || "not resolved"})`,
        )
        .join("\n"),
    }));
  steps.push({
    step: steps.length + 1,
    type: "synthesis",
    title: "Answer evidence",
    description: `${resolved}/${plan.length} tasks supported; stop reason: ${stopReason}.`,
    findings: progress
      .filter((hop) => hop.status !== "resolved")
      .map(
        (hop) =>
          `${hop.hopId}: ${plan.find((task) => task.id === hop.hopId)?.task || "pending"}`,
      )
      .join("\n"),
  });
  return {
    summary: `${resolved}/${plan.length} required tasks supported. Search stopped: ${stopReason}.`,
    steps,
    hopPlan: plan,
    hopProgress: progress,
    searchRounds: rounds,
    stopReason,
  };
}
