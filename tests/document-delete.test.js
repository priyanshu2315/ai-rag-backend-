import assert from "node:assert/strict";
import { after, mock, test } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";

const documentId = "12345678-1234-4234-8234-123456789abc";
const owner = "owner-1";
process.env.JWT_SECRET = "document-delete-offline-test-secret";
process.env.SUPABASE_URL = "https://test.supabase.co";
let state;

mock.module("../src/config/db.js", {
  defaultExport: {
    document: {
      findFirst: async ({ where }) => {
        state.lookups++;
        assert.deepEqual(where, { id: documentId, userId: owner });
        return state.document?.id === where.id && state.document.userId === where.userId
          ? state.document : null;
      },
      deleteMany: async ({ where }) => {
        assert.deepEqual(where, {
          id: documentId, userId: owner, status: { in: ["COMPLETED", "FAILED"] },
        });
        state.operations.push("database");
        if (state.databaseError) throw new Error("Database unavailable");
        state.document = null;
        return { count: 1 };
      },
    },
  },
});
mock.module("../src/config/queue.js", { namedExports: { documentQueue: {} } });
mock.module("../src/config/uploadProgress.js", {
  namedExports: { createSubscriber: () => {}, getChannel: () => "unused" },
});
mock.module("../src/config/supabase.js", {
  namedExports: {
    supabase: { storage: { from: (bucket) => {
      assert.equal(bucket, "documents");
      return { remove: async (paths) => {
        state.operations.push("storage");
        state.paths = paths;
        return { error: state.storageError || null };
      } };
    } } },
  },
});

const { default: documentRoutes } = await import("../src/routes/document.routes.js");
const app = express();
app.use(express.json());
app.use("/api/documents", documentRoutes);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
after(() => new Promise((resolve) => server.close(resolve)));
const baseUrl = `http://127.0.0.1:${server.address().port}/api/documents`;
const token = jwt.sign({ userId: owner }, process.env.JWT_SECRET);

function reset(overrides = {}) {
  state = {
    document: {
      id: documentId, userId: owner, status: "COMPLETED",
      fileUrl: `${process.env.SUPABASE_URL}/storage/v1/object/public/documents/${owner}/123-report%20July.pdf`,
    },
    operations: [], lookups: 0, ...overrides,
  };
}

async function remove(id = documentId, authorization = `Bearer ${token}`) {
  const response = await fetch(`${baseUrl}/${id}`, {
    method: "DELETE",
    headers: authorization ? { Authorization: authorization } : {},
  });
  return { status: response.status, body: await response.json() };
}

test("authenticated owner deletes storage then the scoped DB record", async () => {
  reset();
  const result = await remove();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    success: true, message: "Document deleted successfully", data: { documentId },
  });
  assert.deepEqual(state.operations, ["storage", "database"]);
  assert.deepEqual(state.paths, [`${owner}/123-report July.pdf`]);
  assert.equal((await remove()).status, 404);
  assert.deepEqual(state.operations, ["storage", "database"]);
});

test("missing or invalid bearer tokens cannot delete anything", async () => {
  for (const authorization of [null, "Bearer invalid"]) {
    reset();
    assert.equal((await remove(documentId, authorization)).status, 401);
    assert.equal(state.lookups, 0);
    assert.deepEqual(state.operations, []);
  }
});

test("a signed token without a user ID is rejected before a DB lookup", async () => {
  reset();
  const emptyToken = jwt.sign({}, process.env.JWT_SECRET);
  assert.equal((await remove(documentId, `Bearer ${emptyToken}`)).status, 401);
  assert.equal(state.lookups, 0);
});

test("invalid document IDs return 400 before any lookup", async () => {
  reset();
  assert.deepEqual(await remove("not-a-uuid"), {
    status: 400, body: { success: false, error: "Invalid document ID" },
  });
  assert.equal(state.lookups, 0);
});

test("missing documents and another user's documents both return 404", async () => {
  for (const missing of [true, false]) {
    reset();
    if (missing) state.document = null;
    else state.document.userId = "another-user";
    assert.deepEqual(await remove(), {
      status: 404, body: { success: false, error: "Document not found" },
    });
    assert.deepEqual(state.operations, []);
  }
});

test("processing or nonterminal documents return 409 without side effects", async () => {
  for (const status of ["PROCESSING", "QUEUED", "SUMMARIZING"]) {
    reset();
    state.document.status = status;
    assert.equal((await remove()).status, 409);
    assert.deepEqual(state.operations, []);
  }
});

test("failed documents and documents without stored files can be deleted", async () => {
  reset();
  state.document.status = "FAILED";
  state.document.fileUrl = null;
  assert.equal((await remove()).status, 200);
  assert.deepEqual(state.operations, ["database"]);
});

test("a storage failure retains the document and returns 502", async () => {
  reset({ storageError: { statusCode: 503 } });
  assert.equal((await remove()).status, 502);
  assert.ok(state.document);
  assert.deepEqual(state.operations, ["storage"]);
});

test("a DB failure returns 500 and a retry tolerates the already removed file", async () => {
  reset({ databaseError: true });
  const result = await remove();
  assert.equal(result.status, 500);
  assert.equal(result.body.error, "Failed to delete document. Please try again.");
  assert.ok(state.document);
  state.databaseError = false;
  state.storageError = { statusCode: "404" };
  assert.equal((await remove()).status, 200);
});

test("untrusted storage URLs cannot target another bucket or owner", async () => {
  for (const fileUrl of [
    "https://other.supabase.co/storage/v1/object/public/documents/owner-1/report.pdf",
    "https://test.supabase.co/storage/v1/object/public/avatars/owner-1/report.pdf",
    "https://test.supabase.co/storage/v1/object/public/documents/another-user/report.pdf",
    "https://test.supabase.co/storage/v1/object/public/documents/owner-1/..%2Fanother-user/report.pdf",
  ]) {
    reset();
    state.document.fileUrl = fileUrl;
    assert.equal((await remove()).status, 500);
    assert.deepEqual(state.operations, []);
  }
});
