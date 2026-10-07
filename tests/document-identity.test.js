import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLlamaParseResult } from "../src/services/extraction-normalizer.service.js";
import { collectHeadingCandidates } from "../src/services/heading-candidates.service.js";
import { buildDocumentIdentity } from "../src/services/document-identity.service.js";

function inspect(...pages) {
  const extraction = normalizeLlamaParseResult(
    [{
      pages: pages.map((md, index) => ({ page: index + 1, md })),
    }],
    { filename: "handbook.pdf", mimetype: "application/pdf" },
  );
  const headings = collectHeadingCandidates(extraction);

  return {
    extraction,
    headings,
    identity: buildDocumentIdentity(extraction, headings),
  };
}

test("collects opening title lines separately from numbered sections", () => {
  const { identity } = inspect(
    "# TESSALY PARCEL NETWORK\n\n" +
    "## DEPOT HANDBOOK TPN-SH-2026-10\n\n" +
    "### 1. OVERVIEW\n\nOpening text.",
    "# 7. DOCK EQUIPMENT MAINTENANCE\n\nMaintenance text.",
  );

  assert.equal(identity.title, "handbook.pdf");
  assert.equal(identity.titleSource, "filename");
  assert.equal(identity.status, "fallback");
  assert.deepEqual(identity.proposal.parts.map((part) => part.text), [
    "TESSALY PARCEL NETWORK",
    "DEPOT HANDBOOK TPN-SH-2026-10",
  ]);
  assert.equal(identity.proposal.status, "unresolved");
});

test("does not promote an ambiguous first heading to a confirmed title", () => {
  const { identity } = inspect("# Introduction\n\nSome body text.");
  assert.equal(identity.title, "handbook.pdf");
  assert.equal(identity.proposal.text, "Introduction");
  assert.ok(identity.warnings.includes("DOCUMENT_TITLE_UNCONFIRMED"));
});

test("lists, quotes, numbered headings and body text stop title inference", () => {
  for (const markdown of [
    "1. Complete the form.\n2. Submit it.",
    "> # Quoted title",
    "# 1. OVERVIEW",
    "Opening body text.\n\n# Later section",
    "```md\n# Example title\n```\n\n# Later section",
  ]) {
    assert.equal(inspect(markdown).identity.proposal, null);
  }
});

test("does not append later headings after body text or a source boundary", () => {
  const { identity } = inspect(
    "# Guide\n\nBody text.\n\n## Another section",
    "# Other document",
  );
  assert.deepEqual(identity.proposal.parts.map((part) => part.text), ["Guide"]);
});

test("retains real source locations after a blank source", () => {
  const { extraction, identity } = inspect(
    "",
    "Guide\r\n=====\r\n\r\n## 🧭 Navigation\r\n\r\nBody.",
  );
  for (const part of identity.proposal.parts) {
    const location = part.locations[0];
    assert.equal(location.sourceId, "source-2");
    assert.equal(location.sourcePageNumber, 2);
    assert.ok(
      extraction.pages[1].text
        .slice(location.startOffset, location.endOffset)
        .includes(part.text),
    );
  }
});

test("does not mutate or share proposal locations with collector output", () => {
  const { extraction, headings } = inspect("# Guide\n\nBody.");
  const before = structuredClone({ extraction, headings });
  const identity = buildDocumentIdentity(extraction, headings);
  identity.proposal.parts[0].locations[0].startOffset = 999;
  assert.deepEqual({ extraction, headings }, before);
});

test("rejects stale candidate offsets or text", () => {
  const { extraction, headings } = inspect("# Guide\n\nBody.");
  headings.candidates[0].rawText = "# Different title";
  assert.throws(
    () => buildDocumentIdentity(extraction, headings),
    /does not match its source/,
  );
});
