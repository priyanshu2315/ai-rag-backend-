# Delete a document

```http
DELETE /api/documents/:docId
Authorization: Bearer <access_token>
```

Local URL: `http://localhost:3000/api/documents/:docId`

Render URL after deployment: `https://ai-rag-backend-sm81.onrender.com/api/documents/:docId`

Pass the document UUID in the path. No JSON body or query parameters are required. The authenticated user must own the document. Documents must have status `COMPLETED` or `FAILED`; processing documents return 409 so the worker cannot recreate data during deletion.

## Success: 200

```json
{
  "success": true,
  "message": "Document deleted successfully",
  "data": {
    "documentId": "12345678-1234-4234-8234-123456789abc"
  }
}
```

Deletes the uploaded Supabase object and the document record (including its summary). Existing database foreign keys cascade to parent chunks, child chunks and embeddings, document-specific conversations, and their messages. Conversations not linked to the document are unaffected.

## Errors

| Status | Meaning |
| --- | --- |
| 400 | Invalid document UUID |
| 401 | Missing/invalid bearer token or missing user identity |
| 404 | Document does not exist, belongs to another user, or was already deleted |
| 409 | Document is still processing |
| 502 | Supabase could not remove the uploaded file |
| 500 | Unexpected database/configuration failure |

Endpoint error format:

```json
{
  "success": false,
  "error": "Document not found"
}
```

The existing authentication middleware returns `{"error":"Unauthorized: No token provided"}` or `{"error":"Unauthorized: Invalid token"}` for bearer-token failures.

## Cleanup and retries

Storage is deleted before the database record. If storage deletion fails, the database record remains. If database deletion fails afterwards, retry the same request: a missing storage object is tolerated. These two services do not share an atomic transaction; during a partial failure the document record may temporarily reference an already-deleted file.

## Offline verification

```powershell
node --experimental-test-module-mocks --test tests/document-delete.test.js
```

Tests run the Express endpoint and real authentication/service/repository logic with mocked database and storage clients. They do not delete real documents or verify deployed database constraints.
