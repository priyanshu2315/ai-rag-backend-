# Project instructions

## Change approval

- Do not edit, create, delete, rename, format, or auto-fix project files unless the user explicitly asks you to make that change or approves a specific proposed change. This includes code, tests, configuration, migrations, and documentation.
- A request to explain, inspect, review, debug, or plan is read-only. You may read files and suggest changes, but do not apply them.
- A clear request such as "fix this bug" or "implement this feature" authorizes the changes needed for that request. Keep edits within its scope; ask before making additional unrelated changes.
- If the user's intent to modify files is unclear, describe the proposed edit and ask for approval before writing.
- Do not run database migrations, seeds, destructive commands, or actions that change external services without an explicit request or approval.

## Project map

- This repository is a Node.js ES-module Express backend for chat over uploaded documents. There is no frontend here. `server.js` mounts `/api/auth`, `/api/documents`, `/api/chat`, and `/api/health`, and starts the document worker.
- Code is organized as `src/routes` -> `src/controllers` -> `src/services` -> `src/repositories`; `src/config` holds clients and infrastructure. Auth uses JWT via `src/middlewares/auth.middleware.js`.
- Ingestion: upload to Supabase Storage, enqueue a BullMQ job in Redis, then `src/workers/document.worker.js` parses pages, creates parent/child chunks, embeds child chunks, stores them in PostgreSQL/pgvector, and summarizes the document. Progress uses Redis Pub/Sub and SSE.
- Chat: `src/services/chat.service.js` runs an input security check, loads history, invokes the LangGraph corrective RAG pipeline in `src/services/crag.service.js`, and streams an answer through SSE. Search and conversation persistence live in `src/repositories/chat.repository.js`.
- Database schema and migrations are in `prisma/`; Prisma Client is generated into `generated/prisma`. `src/config/db.js` uses the PostgreSQL driver adapter. Follow `PRISMA_WORKFLOW.md` for approved schema changes.
- For deeper context, read only the relevant sections of `PRODUCT.md`, `docs/chat-pipeline.md`, and `docs/delete-document-api.md`. Treat docs as orientation and verify details against current code.
- `npm test` is a placeholder that exits with an error; use relevant targeted tests when changes are authorized.
