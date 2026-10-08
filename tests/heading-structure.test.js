import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLlamaParseResult } from "../src/services/extraction-normalizer.service.js";
import { collectHeadingCandidates } from "../src/services/heading-candidates.service.js";
import { buildDocumentIdentity } from "../src/services/document-identity.service.js";
import { normalizeHeadingStructure } from "../src/services/heading-structure.service.js";

function inspect(markdown) {
  const extraction = normalizeLlamaParseResult(
    [{ pages: [{ page: 1, md: markdown }] }],
    { filename: "guide.pdf", mimetype: "application/pdf" },
  );
  const candidates = collectHeadingCandidates(extraction);
  const identity = buildDocumentIdentity(extraction, candidates);
  return {
    candidates,
    identity,
    result: normalizeHeadingStructure(candidates, identity),
  };
}

function numbered(result, label) {
  return result.decisions.find((item) => item.numbering?.label === label);
}

test("17 and 18 become siblings despite conflicting Markdown levels", () => {
  const { result } = inspect(
    "# Guide\n\n### 17. Equipment\n\nBody.\n\n#### 18. Safety",
  );
  const a = numbered(result, "17");
  const b = numbered(result, "18");
  assert.equal(a.depth, 1);
  assert.equal(b.depth, 1);
  assert.equal(b.parentCandidateId, a.parentCandidateId);
  assert.ok(b.warnings.includes("MARKDOWN_LEVEL_CONFLICT"));
  assert.equal(result.identity.title, "Guide");
  assert.equal(result.identity.titleSource, "filename_match");
});

test("bold 5A follows 5 as a sibling, without becoming a reference link", () => {
  const { result } = inspect(
    "## 5. Finance\n\nBody.\n\n**5A. Column meanings**\n\nExplanation.\n\n# 6. Pallets",
  );
  const headings = ["5", "5A", "6"].map((label) => numbered(result, label));
  assert.ok(headings.every((item) => item.status === "inferred"));
  assert.ok(
    headings.every(
      (item) => item.depth === 1 && item.parentCandidateId === null,
    ),
  );
});

test("decimal sections use their active numbered parent", () => {
  const { result } = inspect(
    "# 5. Finance\n\nBody.\n\n# 5.1 Rates\n\nBody.\n\n#### 5.2 Charges",
  );
  const parent = numbered(result, "5");
  for (const label of ["5.1", "5.2"]) {
    assert.equal(numbered(result, label).parentCandidateId, parent.id);
    assert.equal(numbered(result, label).depth, 2);
  }
});

test("a missing decimal parent and a numbering restart require review", () => {
  const missing = inspect(
    "# 17. Equipment\n\nBody.\n\n## 18.2 Exceptions",
  ).result;
  assert.equal(numbered(missing, "18.2").status, "unresolved");
  assert.equal(numbered(missing, "18.2").depth, null);
  const restart = inspect("# 2. Earlier\n\nBody.\n\n## 1. Restart").result;
  assert.ok(
    numbered(restart, "1").reasons.includes("NUMBERING_RESTART_OR_DUPLICATE"),
  );
});

test("numbered list items and quoted headings remain content", () => {
  const { result } = inspect(
    "# 5. Finance\n\n1. Complete the form.\n2. Submit the form.\n\n> # Quoted heading\n\n## 6. Pallets",
  );
  const nested = result.decisions.filter((item) =>
    item.containers.some((type) => type !== "root"),
  );
  assert.equal(nested.length, 3);
  assert.ok(
    nested.every((item) => item.role === "content" && item.depth === null),
  );
  assert.equal(numbered(result, "6").depth, 1);
});

test("an explicit chapter boundary scopes restarted numbering", () => {
  const { result } = inspect(
    "Preamble.\n\n# Chapter A\n\nText.\n\n## 1. First\n\nText.\n\n" +
      "# Chapter B\n\nText.\n\n## 1. Second",
  );
  const first = result.decisions.find((item) => item.title === "1. First");
  const second = result.decisions.find((item) => item.title === "1. Second");
  const chapterB = result.decisions.find((item) => item.title === "Chapter B");
  assert.notEqual(first.parentCandidateId, second.parentCandidateId);
  assert.equal(second.parentCandidateId, chapterB.id);
  assert.equal(second.status, "inferred");
});

test("unsupported bold headings and title proposals remain unresolved", () => {
  const { result } = inspect(
    "# Unconfirmed title\n\nBody.\n\n**COURSE FEES**\n\nFees.\n\n**VARIOUS DEVELOPMENTAL ACTIVITIES**",
  );
  assert.equal(result.decisions[0].role, "title_candidate");
  assert.ok(result.decisions.every((item) => item.status === "unresolved"));
  assert.equal(result.reviewCandidateIds.length, 3);
});

test("does not mutate input or guess a parent after a bold numbered heading", () => {
  const { candidates, identity, result } = inspect(
    "# 5. Finance\n\nBody.\n\n**5A. Details**\n\nBody.\n\n### Notes",
  );
  const before = structuredClone({ candidates, identity });
  const again = normalizeHeadingStructure(candidates, identity);
  again.identity.title = "changed";
  again.decisions[0].locations[0].startOffset = 999;
  assert.deepEqual({ candidates, identity }, before);
  const notes = result.decisions.at(-1);
  assert.equal(notes.status, "unresolved");
  assert.ok(notes.reasons.includes("MARKDOWN_PARENT_LEVEL_UNAVAILABLE"));
});
