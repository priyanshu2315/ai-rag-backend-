import assert from "node:assert/strict";
import { test } from "node:test";
import { getParentNeighbors } from "../src/repositories/chat.repository.js";

test("search follows an interrupted table without crossing into the intervening section", async () => {
  const first = {
    id: "first", documentId: "document-1", prevParentId: null,
    nextParentId: null, metadata: {
      section_id: "section-5", chunk_index: 1,
      linked_table_ids: ["table-1"],
    },
  };
  const continuation = {
    id: "continuation", documentId: "document-1", prevParentId: null,
    nextParentId: null, metadata: {
      section_id: "section-5", chunk_index: 3,
      linked_table_ids: ["table-1"],
    },
  };
  let calls = 0;
  const db = { parentChunk: { findMany: async ({ where, take }) => {
    calls++;
    assert.equal(where.documentId, "document-1");
    assert.deepEqual(where.document, { userId: "owner-1", status: "COMPLETED" });
    assert.deepEqual(where.metadata, {
      path: ["linked_table_ids"], array_contains: ["table-1"],
    });
    assert.equal(take, 24);
    return [continuation, first];
  } } };

  const result = await getParentNeighbors([first], "owner-1", db);
  assert.equal(calls, 1);
  assert.deepEqual(result.map((parent) => parent.id), ["first", "continuation"]);
  assert.deepEqual(result[1].retrievalOrigin, {
    type: "table_continuation", seedParentId: "first", tableId: "table-1",
  });
});

test("search does not expand a table without a continuation", async () => {
  const parent = {
    id: "single", documentId: "document-1", prevParentId: null,
    nextParentId: null, metadata: { section_id: "section-5", table_ids: ["table-1"] },
  };
  const db = { parentChunk: { findMany: () => {
    throw new Error("Unlinked tables should not trigger another database query");
  } } };
  assert.deepEqual(await getParentNeighbors([parent], "owner-1", db), [parent]);
});
