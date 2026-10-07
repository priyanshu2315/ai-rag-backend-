function numberingParts(candidate) {
  return (
    candidate.numbering?.parts.map(
      (part) => part.toUpperCase(),
    ) ?? []
  );
}

function family(parts) {
  return parts.slice(0, -1).join(".");
}

function siblingOrder(previous, current) {
  const read = (part) => {
    const match = /^(\d+)([A-Z]?)$/.exec(part);

    return match
      ? [BigInt(match[1]), match[2]]
      : null;
  };

  const a = read(previous.at(-1));
  const b = read(current.at(-1));

  if (!a || !b) {
    return "unknown";
  }

  if (b[0] === a[0]) {
    const suffix = (value) =>
      value ? value.charCodeAt(0) - 64 : 0;

    const difference = suffix(b[1]) - suffix(a[1]);

    return difference === 1
      ? "next"
      : difference > 1
        ? "forward"
        : "restart";
  }

  if (b[0] === a[0] + 1n && b[1] === "") {
    return "next";
  }

  return b[0] > a[0] ? "forward" : "restart";
}

export function normalizeHeadingStructure(
  headingResult,
  identity,
) {
  if (
    headingResult?.version !== "heading-candidates-v1" ||
    !Array.isArray(headingResult.candidates) ||
    identity?.version !== "document-identity-v1"
  ) {
    throw new TypeError(
      "Expected heading candidates and document identity",
    );
  }

  const titleIds = new Set(
    identity.proposal?.parts.map(
      (part) => part.candidateId,
    ) ?? [],
  );

  const decisions = [];
  const stack = [];
  const ids = new Set();

  for (const candidate of headingResult.candidates) {
    if (!candidate.id || ids.has(candidate.id)) {
      throw new TypeError(
        "Heading candidate IDs must be unique",
      );
    }

    ids.add(candidate.id);

    const decision = {
      ...structuredClone(candidate),
      role: "unresolved",
      status: "unresolved",
      parentCandidateId: null,
      depth: null,
      reasons: [],
    };

    decisions.push(decision);

    const unresolved = (reason) => {
      decision.reasons.push(reason);

      // Do not infer later ancestry through
      // an uncertain boundary.
      stack.length = 0;
    };

    if (
      candidate.containers.some(
        (type) => type !== "root",
      )
    ) {
      decision.role = "content";
      decision.status = "retained";
      decision.reasons.push("NESTED_CONTENT_CONTEXT");
      continue;
    }

    if (candidate.kind === "ordered_list_item") {
      decision.role = "content";
      decision.status = "retained";
      decision.reasons.push("ORDERED_LIST_CONTEXT");
      continue;
    }

    if (identity.acceptedCandidateIds?.includes(candidate.id)) {
      decision.role = "document_title";
      decision.status = "retained";
      decision.reasons.push("DOCUMENT_IDENTITY_EVIDENCE");
      stack.length = 0;
      continue;
    }

    if (titleIds.has(candidate.id)) {
      decision.role = "title_candidate";
      unresolved("DOCUMENT_TITLE_UNCONFIRMED");
      continue;
    }

    if (
      !candidate.title.trim() ||
      candidate.locations.length !== 1
    ) {
      unresolved("HEADING_REQUIRES_REVIEW");
      continue;
    }

    const parts = numberingParts(candidate);

    const peer = parts.length
      ? stack.findLast(
          (entry) =>
            entry.parts.length === parts.length &&
            family(entry.parts) === family(parts),
        )
      : null;

    const order = peer
      ? siblingOrder(peer.parts, parts)
      : null;

    const explicit =
      candidate.kind === "markdown_heading";

    // Bold formatting plus an active consecutive
    // numbering pattern can support a candidate.
    const supportedHeuristic =
      candidate.kind === "standalone_bold" &&
      order === "next";

    if (!explicit && !supportedHeuristic) {
      unresolved("INSUFFICIENT_HEADING_EVIDENCE");
      continue;
    }

    decision.role = "section";

    if (
      peer &&
      !["next", "forward"].includes(order)
    ) {
      unresolved("NUMBERING_RESTART_OR_DUPLICATE");
      continue;
    }

    let parent = null;

    if (parts.length > 1) {
      const parentLabel = parts
        .slice(0, -1)
        .join(".");

      parent = stack.findLast(
        (entry) =>
          entry.parts.join(".") === parentLabel,
      );

      if (!parent) {
        unresolved("NUMBERED_PARENT_NOT_ACTIVE");
        continue;
      }

      decision.reasons.push(
        "EXPLICIT_NUMBERED_PARENT",
      );
    } else if (peer) {
      parent =
        stack.find(
          (entry) =>
            entry.decision.id ===
            peer.decision.parentCandidateId,
        ) ?? null;

      decision.reasons.push(
        "NUMBERED_SIBLING_PATTERN",
      );
    } else {
      if (
        stack.some(
          (entry) =>
            entry.decision.originalLevel === null,
        )
      ) {
        unresolved(
          "MARKDOWN_PARENT_LEVEL_UNAVAILABLE",
        );
        continue;
      }

      parent =
        stack.findLast(
          (entry) =>
            Number.isInteger(
              entry.decision.originalLevel,
            ) &&
            entry.decision.originalLevel <
              candidate.originalLevel,
        ) ?? null;

      decision.reasons.push("MARKDOWN_HIERARCHY");
    }

    if (supportedHeuristic) {
      decision.reasons.push(
        "CONSECUTIVE_NUMBERING_SUPPORT",
      );
    }

    if (order === "forward") {
      decision.warnings.push("NUMBERING_GAP");
    }

    if (
      peer &&
      explicit &&
      Number.isInteger(
        peer.decision.originalLevel,
      ) &&
      peer.decision.originalLevel !==
        candidate.originalLevel
    ) {
      decision.warnings.push(
        "MARKDOWN_LEVEL_CONFLICT",
      );
    }

    decision.status = "inferred";

    decision.parentCandidateId =
      parent?.decision.id ?? null;

    decision.depth = parent
      ? parent.decision.depth + 1
      : 1;

    stack.length = parent
      ? stack.indexOf(parent) + 1
      : 0;

    stack.push({ decision, parts });
  }

  return {
    version: "heading-structure-v1",
    identity: structuredClone(identity),
    decisions,
    reviewCandidateIds: decisions
      .filter(
        (decision) =>
          decision.status === "unresolved",
      )
      .map((decision) => decision.id),
  };
}