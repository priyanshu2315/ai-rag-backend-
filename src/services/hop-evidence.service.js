// These checks establish provenance and dependency consistency. The grader
// still decides whether a cited passage semantically answers the whole task.
export const normalizeText = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
export const queryKey = (query) => normalizeText(query).toLowerCase();

export function validateHopPlan(plan) {
  if (!Array.isArray(plan) || !plan.length || plan.length > 12) {
    throw new Error("Expected between one and twelve question tasks");
  }
  const seen = new Set();
  return plan.map((hop) => {
    if (!hop || typeof hop.id !== "string" || !hop.id.trim() || seen.has(hop.id) ||
      typeof hop.task !== "string" || !hop.task.trim() || !Array.isArray(hop.dependsOn) ||
      hop.dependsOn.some((id) => !seen.has(id)) || new Set(hop.dependsOn).size !== hop.dependsOn.length) {
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
  return new Set(progress.filter((hop) => hop.status === "resolved")
    .flatMap((hop) => hop.evidence.map((item) => item.chunkId)));
}

export function validateGradeResponse(parsed, plan, documents) {
  if (!parsed || !Array.isArray(parsed.relevant_chunk_ids) || !Array.isArray(parsed.hops)) {
    throw new Error("Grader must return relevant_chunk_ids and hops arrays");
  }
  const documentIds = new Set(documents.map((doc) => doc.id));
  const hopIds = new Set(plan.map((hop) => hop.id));
  const updates = new Map();
  const validationWarnings = [];
  const relevantIds = parsed.relevant_chunk_ids.filter((id) => documentIds.has(id));
  if (relevantIds.length !== parsed.relevant_chunk_ids.length) {
    validationWarnings.push("Unknown relevance chunk IDs were ignored");
  }
  for (const update of parsed.hops) {
    if (!update || !hopIds.has(update.hopId)) {
      validationWarnings.push("An unknown task result was ignored");
      continue;
    }
    const pending = (reason) => ({ hopId: update.hopId, status: "pending", value: "",
      inputBindings: {}, evidence: [], reason });
    if (updates.has(update.hopId)) {
      updates.set(update.hopId, pending("duplicate_task_result"));
      validationWarnings.push(`Duplicate result for ${update.hopId} remains pending`);
    } else if (update.status === "pending") {
      // Unresolved tasks do not need invented values, bindings or evidence.
      updates.set(update.hopId, pending("not_resolved"));
    } else if (update.status !== "resolved" || typeof update.value !== "string" ||
      !update.inputBindings || typeof update.inputBindings !== "object" || Array.isArray(update.inputBindings) ||
      !Array.isArray(update.evidence)) {
      updates.set(update.hopId, pending("invalid_task_result"));
      validationWarnings.push(`Invalid result for ${update.hopId} remains pending`);
    } else {
      updates.set(update.hopId, update);
    }
  }
  return { ...parsed, relevant_chunk_ids: [...new Set(relevantIds)], hops: [...updates.values()], validationWarnings };
}

// Read only answer content. Empty/reasoning-only/truncated responses are not answers.
export function readModelContent(response) {
  const choice = response?.choices?.[0];
  if (!response || !choice || typeof choice.message?.content !== "string" || !choice.message.content.trim()) {
    const error = new Error("The model returned no usable answer content");
    error.code = "empty_model_response";
    throw error;
  }
  if (choice.finish_reason && choice.finish_reason !== "stop") {
    const error = new Error(`The model response did not finish normally (${choice.finish_reason})`);
    error.code = "incomplete_model_response";
    throw error;
  }
  return choice.message.content;
}

export function modelFailureDetails(error, response) {
  return {
    message: String(error?.message || "Unknown model response failure").slice(0, 1000),
    code: error?.code ?? error?.error?.code ?? null,
    status: error?.status ?? null,
    requestId: error?.request_id ?? null,
    model: response?.model ?? null,
    finishReason: response?.choices?.[0]?.finish_reason ?? null,
    hasAnswerContent: typeof response?.choices?.[0]?.message?.content === "string" &&
      response.choices[0].message.content.trim().length > 0,
  };
}

export const isQuoteInDocText = (quote, text) => {
  const normText = normalizeText(text).toLowerCase();
  const normQuote = normalizeText(quote).toLowerCase();
  if (normText.includes(normQuote)) return true;
  const parts = normQuote.split(/\.{3,}|\u2026/).map((p) => p.trim()).filter((p) => p.length >= 4);
  if (parts.length > 1) {
    let lastIndex = 0;
    for (const part of parts) {
      const idx = normText.indexOf(part, lastIndex);
      if (idx === -1) return false;
      lastIndex = idx + part.length;
    }
    return true;
  }
  return false;
};

export function updateHopProgress(plan, previous, updates, documents) {
  const docs = new Map(documents.map((doc) => [doc.id, doc]));
  const candidates = new Map(previous.map((item) => [item.hopId, item]));
  for (const update of updates) candidates.set(update.hopId, update);
  const checked = new Map();
  for (const hop of plan) {
    const candidate = candidates.get(hop.id);
    let reason = candidate?.reason || "not_resolved";
    if (candidate?.status === "resolved") {
      reason = "";
      if (typeof candidate.value !== "string" || !candidate.value.trim()) reason = "missing_value";
      for (const dependency of hop.dependsOn) {
        const prior = checked.get(dependency);
        if (prior?.status !== "resolved") reason ||= "unresolved_dependency";
        else {
          const bindingVal = normalizeText(candidate.inputBindings?.[dependency]).toLowerCase();
          const priorVal = normalizeText(prior.value).toLowerCase();
          const bindingMatches = Boolean(
            bindingVal && priorVal && (
              bindingVal === priorVal ||
              (bindingVal.length >= 2 && priorVal.includes(bindingVal)) ||
              (priorVal.length >= 2 && bindingVal.includes(priorVal))
            )
          );
          if (!bindingMatches) {
            reason ||= "invalid_binding";
          }
        }
      }
      if (!Array.isArray(candidate.evidence) || !candidate.evidence.length) reason ||= "missing_evidence";
      else for (const item of candidate.evidence) {
        const doc = docs.get(item?.chunkId);
        const quote = normalizeText(item?.quote);
        if (!doc) reason ||= "missing_chunk";
        else if (typeof item?.quote !== "string" || quote.length < 8 ||
          !isQuoteInDocText(quote, doc.searchText || doc.text)) reason ||= "quote_not_found";
      }
    }
    checked.set(hop.id, reason ? {
      hopId: hop.id, status: "pending", value: "", inputBindings: {}, evidence: [], reason,
    } : {
      hopId: hop.id, status: "resolved", value: candidate.value.trim(),
      inputBindings: Object.fromEntries(hop.dependsOn.map((id) => [id, checked.get(id).value])),
      evidence: candidate.evidence.map((item) => ({ chunkId: item.chunkId, quote: item.quote })),
    });
  }
  return [...checked.values()];
}

export function isPlanComplete(plan, progress) {
  return plan.length > 0 && plan.every((hop) => progress.some((item) =>
    item.hopId === hop.id && item.status === "resolved"));
}

export function nextPendingHop(plan, progress) {
  const resolved = new Set(progress.filter((item) => item.status === "resolved").map((item) => item.hopId));
  return plan.find((hop) => !resolved.has(hop.id) && hop.dependsOn.every((id) => resolved.has(id))) ?? null;
}

export function chooseFollowUp(plan, progress, proposal, executedQueries) {
  const pending = nextPendingHop(plan, progress);
  if (!pending || proposal?.hopId !== pending.id || typeof proposal.query !== "string") return "";
  const query = proposal.query.trim();
  if (query.length < 4 || executedQueries.some((old) => queryKey(old) === queryKey(query))) return "";
  return query;
}

export function progressDecision({ plan, previous, progress, round, maxRounds, noProgressRounds, gradingSucceeded }) {
  const resolved = (items) => new Set(items.filter((hop) => hop.status === "resolved").map((hop) => hop.hopId));
  const before = resolved(previous);
  const madeProgress = progress.some((hop) => hop.status === "resolved" &&
    (!before.has(hop.hopId) || previous.find((old) => old.hopId === hop.hopId)?.value !== hop.value));
  const stalled = madeProgress ? 0 : noProgressRounds + 1;
  const isComplete = gradingSucceeded && isPlanComplete(plan, progress);
  const stopReason = isComplete ? "complete" : round >= maxRounds ? "round_limit" : stalled >= 2 ? "no_progress" : "";
  return { isComplete, noProgressRounds: stalled, stopReason };
}

export function mergeSearchRounds(previous, updates) {
  const rounds = new Map(previous.map((round) => [round.attempt, round]));
  for (const round of updates) rounds.set(round.attempt, { ...rounds.get(round.attempt), ...round });
  return [...rounds.values()].sort((a, b) => a.attempt - b.attempt);
}

// Select supporting documents in whole bundles, then add optional context.
// renderDocument accounts for the actual source wrapper, not just body length.
export function selectEvidenceContext(documents, progress, { maxChunks, maxChars, renderDocument }) {
  const docs = uniqueDocuments(documents);
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  const selected = new Map();
  const separatorSize = "\n\n---\n\n".length;
  let chars = 0;
  const addBundle = (ids) => {
    const newIds = [...new Set(ids)].filter((id) => !selected.has(id));
    if (newIds.some((id) => !byId.has(id))) return false;
    const extra = newIds.reduce((sum, id, index) => sum + renderDocument(byId.get(id)).length +
      ((selected.size || index) ? separatorSize : 0), 0);
    if (selected.size + newIds.length > maxChunks || chars + extra > maxChars) return false;
    for (const id of newIds) selected.set(id, byId.get(id));
    chars += extra;
    return true;
  };
  const required = evidenceIds(progress);
  for (const hop of progress.filter((item) => item.status === "resolved")) {
    addBundle(hop.evidence.map((item) => item.chunkId));
  }
  for (const doc of docs) if (!required.has(doc.id)) addBundle([doc.id]);
  return [...selected.values()].sort((a, b) => (a.documentId || "").localeCompare(b.documentId || "") ||
    (a.metadata?.chunk_index ?? 0) - (b.metadata?.chunk_index ?? 0));
}

export function buildHopReasoningChain(plan, progress, rounds, stopReason) {
  const resolved = progress.filter((hop) => hop.status === "resolved").length;
  const steps = rounds.filter((round) => round.queries?.length).map((round, index) => ({
    step: index + 1,
    type: index === 0 ? "initial_search" : "multi_hop_search",
    title: `Search round ${round.attempt}`,
    description: round.queries.join(" | "),
    findings: (round.hopProgress || []).map((hop) => hop.status === "resolved"
      ? `${hop.hopId}: ${hop.value} (chunks: ${hop.evidence.map((item) => item.chunkId).join(", ")})`
      : `${hop.hopId}: pending (${hop.reason || "not resolved"})`).join("\n"),
  }));
  steps.push({
    step: steps.length + 1, type: "synthesis", title: "Answer evidence",
    description: `${resolved}/${plan.length} tasks supported; stop reason: ${stopReason}.`,
    findings: progress.filter((hop) => hop.status !== "resolved").map((hop) =>
      `${hop.hopId}: ${plan.find((task) => task.id === hop.hopId)?.task || "pending"}`).join("\n"),
  });
  return { summary: `${resolved}/${plan.length} required tasks supported. Search stopped: ${stopReason}.`,
    steps, hopPlan: plan, hopProgress: progress, searchRounds: rounds, stopReason };
}
