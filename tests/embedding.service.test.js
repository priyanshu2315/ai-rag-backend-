import assert from "node:assert/strict";
import test from "node:test";
import { createEmbeddingService } from "../src/services/embedding.service.js";

// This test tokenizer gives one token per code point plus two special tokens.
// Production uses the real model tokenizer; this fake makes boundaries exact.
function fixture(modelLimit = 256) {
  const calls = { loads: 0, tokenizations: [], embeddings: [] };

  const extractor = async (text, options) => {
    calls.embeddings.push({ text, options });
    return { data: new Float32Array(384) };
  };

  extractor.tokenizer = async (text, options) => {
    calls.tokenizations.push({ text, options });
    return { input_ids: { data: new BigInt64Array([...text].length + 2) } };
  };
  extractor.tokenizer.model_max_length = modelLimit;

  const service = createEmbeddingService(async () => {
    calls.loads++;
    return extractor;
  });

  return { service, calls, extractor };
}

test("measures the full input with special tokens and no truncation", async () => {
  const { service, calls } = fixture();
  const text = "Document: guide.pdf\nSection: 5. Rates\n\nFee: 25";
  const details = await service.measureEmbeddingInput(text);
  assert.equal(details.tokenCount, [...text].length + 2);
  assert.deepEqual(calls.tokenizations[0], {
    text,
    options: { add_special_tokens: true, truncation: false, padding: false },
  });
});

test("counts the complete contextual input instead of just the passage", async () => {
  const { service } = fixture();
  assert.equal((await service.measureEmbeddingInput("x".repeat(250))).withinLimit, true);
  assert.equal((await service.measureEmbeddingInput(
    "Document: guide.pdf\n\n" + "x".repeat(250),
  )).withinLimit, false);
});

test("accepts exactly the limit and rejects one token over before inference", async () => {
  const { service, calls } = fixture();
  const vector = await service.getEmbedding("x".repeat(254), { rejectTruncation: true });
  assert.equal(vector.length, 384);

  let reported;
  await assert.rejects(
    () => service.getEmbedding("x".repeat(255), {
      rejectTruncation: true,
      onDetails: (details) => { reported = details; },
    }),
    (error) => error.code === "EMBEDDING_INPUT_TOO_LARGE" &&
      error.details.tokenCount === 257,
  );
  assert.equal(calls.embeddings.length, 1);
  assert.equal(reported.withinLimit, false);
});

test("uses the lower of the tokenizer limit and the indexing limit", async () => {
  const smaller = fixture(128);
  const larger = fixture(512);
  assert.equal((await smaller.service.measureEmbeddingInput("text")).tokenLimit, 128);
  assert.equal((await larger.service.measureEmbeddingInput("text")).tokenLimit, 256);
});

test("shares one model load across simultaneous measurement and embedding", async () => {
  const { service, calls } = fixture();
  await Promise.all([
    service.measureEmbeddingInput("first"),
    service.measureEmbeddingInput("second"),
    service.getEmbedding("third", { rejectTruncation: true }),
  ]);
  assert.equal(calls.loads, 1);
  assert.deepEqual(calls.embeddings[0].options, {
    pooling: "mean", normalize: true,
  });
});

test("can retry loading after a failed initialization", async () => {
  const { extractor } = fixture();
  let attempts = 0;
  const service = createEmbeddingService(async () => {
    if (++attempts === 1) throw new Error("Load failed");
    return extractor;
  });
  await assert.rejects(() => service.measureEmbeddingInput("text"), /Load failed/);
  assert.equal((await service.measureEmbeddingInput("text")).withinLimit, true);
  assert.equal(attempts, 2);
});

test("rejects invalid text and invalid tokenizer limits", async () => {
  const { service, calls } = fixture();
  await assert.rejects(() => service.measureEmbeddingInput(null), /must be a string/);
  assert.equal(calls.loads, 0);
  const invalid = fixture(0);
  await assert.rejects(
    () => invalid.service.measureEmbeddingInput("text"),
    /model_max_length/,
  );
});

test("keeps the existing default query path and reports vector dimensions", async () => {
  const { service, calls } = fixture();
  let reported;
  await service.getEmbedding("query", {
    onDetails: (details) => { reported = details; },
  });
  assert.equal(calls.tokenizations.length, 0);
  assert.equal(reported.dimensions, 384);
});
