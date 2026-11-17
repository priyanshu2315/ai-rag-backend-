# Frontend prompt: users, roles and document access

You are working on the frontend repo of a document chat app. The backend (Node/Express, separate repo) is adding users, roles and document access. This file lists what changed in the backend API and what the UI should do. It is updated as backend steps land. All sections below are **Implemented** in the backend (9 November 2026). The backend developer has tested role access, the admin knowledge base and asking about documents outside a user's roles; report any mismatch you find between this file and the real responses.

All authenticated requests send `Authorization: Bearer <token>`.

## Access model (for context)

- One library: every uploaded document is in one place. Only the admin uploads and deletes documents.
- A role is a name plus a list of documents chosen from the library.
- A user has a name, email, a password and one or more roles.
- A normal user sees and searches only the documents in their roles. The admin sees all documents.
- There is no direct document-to-user sharing. To give one person one document, the admin makes a role with that document.
- User type is `ADMIN` or `USER`. Only the admin creates roles and users.
- When access changes, the next request uses the new access. A document that is no longer accessible should return "not found" (404), not "forbidden".

## Target UI structure

Replace the current "documents on the left, chat on the right" layout with an app layout:

- **Header:** app name, global search box (opens a new global chat with the typed question), user menu (name, type, change password, log out).
- **Sidebar modules:**
  - New chat
  - Chats: list of the user's global chats (rename, delete)
  - Knowledge base: the documents this user can access; open one to chat inside it
  - Upload document (admin only)
  - Roles (admin only)
  - Users (admin only)
- Hide admin-only modules when `type !== "ADMIN"`. The backend also enforces this, so a hidden link is a convenience, not the security.
- **Chats:** a user can have many global chats (like Claude), each with its own history, searching all the user's documents. Inside a document there is one chat per user per document (as today).
- Keep the existing "How this was answered" steps panel for assistant messages.

## Step 4: Login changes (Implemented)

### `POST /api/auth/login`

Request is unchanged: `{ email, password }`.

Success response now includes the user's type and flags:

```json
{
  "token": "<jwt>",
  "userId": "uuid",
  "email": "user@example.com",
  "name": null,
  "type": "ADMIN",
  "mustChangePassword": false
}
```

- `name` can be `null` for older accounts. Show the email instead.
- `type` is `"ADMIN"` or `"USER"`. Store it with the session and use it to show or hide admin modules.
- `mustChangePassword` is `true` for users created by the admin with a temporary password. After login, send them to the "Set a new password" screen (Step 6) before anything else.

Errors:

- `401 { "error": "Invalid credentials" }`: wrong email or password.
- `403 { "error": "Account is disabled" }`: the admin disabled this account. Show a clear message; do not offer a retry loop.

### `POST /api/auth/register` is removed (Implemented)

Public sign-up is turned off; the route returns 404. Remove the register page and any "Create account" links. Only the admin creates users (Users module, Planned).

## Step 5: Session checks and admin-only routes (Implemented)

Every authenticated request now loads the account from the database.

- `401 { "error": "Unauthorized: No token provided" }`, `401 { "error": "Unauthorized: Invalid token" }` or `401 { "error": "Unauthorized: Account not active" }`: the token is missing, expired, or the account was disabled or deleted. On any `401` from any endpoint, clear the stored session and go to the login page.
- `403 { "error": "Forbidden: Admin only" }`: a normal user called an admin-only endpoint. Show "You don't have permission"; do not log the user out.
- `500 { "error": "Authentication failed" }`: server problem; show a retry message.

Admin-only endpoints so far:

- `POST /api/documents/upload`
- `DELETE /api/documents/:docId`

Hide the Upload module and the delete buttons when `type !== "ADMIN"`.

## Step 6: Passwords (Implemented)

### `POST /api/auth/change-password` (logged in)

Request: `{ "currentPassword": "...", "newPassword": "..." }`

- `200 { "success": true, "message": "Password changed" }`: the user stays logged in (same token) and `mustChangePassword` is now `false`. Update the stored session flag and continue to the app.
- `401 { "success": false, "error": "Current password is incorrect" }`: show it under the current-password field. This 401 does not mean the session ended; do not log out on this endpoint's 401.
- `400 { "success": false, "error": "..." }` with one of: `currentPassword and newPassword are required`, `New password must be at least 8 characters`, `New password must be different`. Validate the same rules in the form before sending.

Use it for the forced "Set a new password" screen and for "Change password" in the user menu.

### Forced password change

While `mustChangePassword` is `true`, every authenticated endpoint except change-password returns:

```json
403 { "error": "Password change required", "code": "PASSWORD_CHANGE_REQUIRED" }
```

On that code, send the user to the "Set a new password" screen.

### Forgot / reset password (Implemented)

- `POST /api/auth/forgot-password`, body `{ "email" }`: emails a 6-digit code (valid 10 minutes) to a known address and answers `200 { "success": true, "message": "If the account exists, a reset code has been sent." }`. Show that message and move to the reset form, where the user types the code from the email. `400 { "success": false, "error": "Email is required" }` when the email is missing. Development leftover: the response may still include an `otp` field and an unknown email may answer `500`; never show or rely on `otp`, and show the same neutral message on `500`.
- `POST /api/auth/reset-password`, body `{ "email", "otp", "newPassword" }`: unchanged. `200` on success; `400` for `Invalid OTP`, `OTP expired` or missing fields; `404` for an unknown user. A successful reset also clears `mustChangePassword`.

## Step 8: Roles module, admin only (Implemented)

All endpoints are under `/api/roles` and are admin only (`403 Forbidden: Admin only` for normal users). A role is a name, an optional description and a list of documents.

| Method | Path                           | Body                                         | Success                      |
| ------ | ------------------------------ | -------------------------------------------- | ---------------------------- |
| GET    | `/api/roles`                   | none                                         | `200` list of role summaries |
| GET    | `/api/roles/:roleId`           | none                                         | `200` full role              |
| POST   | `/api/roles`                   | `{ "name", "description"?, "documentIds"? }` | `201` full role              |
| PATCH  | `/api/roles/:roleId`           | `{ "name"?, "description"? }`                | `200` full role              |
| DELETE | `/api/roles/:roleId`           | none                                         | `200 { "success": true }`    |
| PUT    | `/api/roles/:roleId/documents` | `{ "documentIds": ["..."] }`                 | `200` full role              |

Role summary (list):

```json
{
  "id": "uuid",
  "name": "Finance",
  "description": null,
  "createdAt": "...",
  "updatedAt": "...",
  "documentCount": 3,
  "userCount": 2
}
```

Full role:

```json
{
  "id": "uuid",
  "name": "Finance",
  "description": null,
  "createdAt": "...",
  "updatedAt": "...",
  "documents": [
    {
      "id": "uuid",
      "filename": "report.pdf",
      "status": "COMPLETED",
      "addedAt": "..."
    }
  ],
  "users": [
    {
      "id": "uuid",
      "name": "Asha",
      "email": "asha@example.com",
      "assignedAt": "..."
    }
  ]
}
```

- `PUT /documents` **replaces** the role's whole document list with `documentIds` (send the full selection from the multi-select dropdown, not just the change). `[]` empties the role.
- Errors (`{ "error": "..." }`): `400` for `Role name is required`, `Role name is too long` (over 100 characters), `documentIds must be an array`, `One or more documents do not exist`, `Nothing to update`; `404 Role not found`; `409 A role with this name already exists`; `500 Something went wrong`.
- Deleting a role removes its documents from every user who had that role; confirm with the admin before calling DELETE and show the role's `userCount` in the confirmation.
- Document dropdown source: `GET /api/documents`. Until Step 10 lands it may not yet return every library document for the admin.

UI: a Roles page (list with counts, create button), a role detail/edit page (name, description, document multi-select, read-only list of users with this role).

## Step 9: Users module, admin only (Implemented)

All endpoints are under `/api/users` and are admin only. There is no delete endpoint: disable a user instead.

| Method | Path                                | Body                                                            | Success                                                                                     |
| ------ | ----------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| GET    | `/api/users?search=text`            | none                                                            | `200` list of users (search matches name or email, case-insensitive; omit `search` for all) |
| GET    | `/api/users/:userId`                | none                                                            | `200` user                                                                                  |
| POST   | `/api/users`                        | `{ "name", "email", "temporaryPassword", "type"?, "roleIds"? }` | `201` user + `emailSent`                                                                    |
| PATCH  | `/api/users/:userId`                | `{ "name"?, "type"?, "isActive"? }`                             | `200` user                                                                                  |
| PUT    | `/api/users/:userId/roles`          | `{ "roleIds": ["..."] }`                                        | `200` user                                                                                  |
| POST   | `/api/users/:userId/reset-password` | `{ "temporaryPassword" }`                                       | `200` user + `emailSent`                                                                    |

User object (the password is never returned):

```json
{
  "id": "uuid",
  "name": "Asha",
  "email": "asha@example.com",
  "type": "USER",
  "isActive": true,
  "mustChangePassword": true,
  "createdAt": "...",
  "updatedAt": "...",
  "roles": [{ "id": "uuid", "name": "Finance", "assignedAt": "..." }]
}
```

- Create: `type` is `"USER"` (default) or `"ADMIN"`. The email is saved in lowercase. The new user has `mustChangePassword: true` and must set a new password at first login (Step 6). The backend emails the new user the platform link, their email and the temporary password, and the response adds `"emailSent": true | false`. On `true`, show "Login details were emailed to <email>". On `false` (mail server problem; the user is still created), show the temporary password once with "The email could not be sent; share these details with the user yourself". The password cannot be read back later.
- `PUT /roles` **replaces** the user's whole role list (send the full selection; `[]` removes all roles, so the user sees no documents).
- `PATCH` with `isActive: false` disables the account: the user's next request gets `401` and login gets `403 Account is disabled`. `isActive: true` enables it again.
- Reset password: sets a new temporary password and `mustChangePassword: true`, and emails it to the user. The response adds `emailSent`; handle it the same way as on create.
- The admin cannot disable or demote their own account: `400 You cannot disable or demote your own account`. Disable those controls on the admin's own row.
- Errors (`{ "error": "..." }`): `400` for `Name is required`, `Name is too long`, `A valid email is required`, `Temporary password must be at least 8 characters`, `type must be ADMIN or USER`, `isActive must be true or false`, `roleIds must be an array`, `One or more roles do not exist`, `Nothing to update`; `404 User not found`; `409 A user with this email already exists`; `500 Something went wrong`.
- Login now matches the email case-insensitively.

UI: a Users page (table with name, email, type, active, roles; search box; create button), a create/edit user form (name, email, temporary password on create, type, role multi-select from `GET /api/roles`), and row actions: disable/enable, reset password.

## Step 10: Documents follow roles (Implemented)

| Endpoint                                           | Who                          | Returns                                                                                                                                                                        |
| -------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/documents`                               | Admin only (`403` for users) | The whole library: `{ success: true, data: [{ id, filename, createdAt, fileUrl, status, summaryStatus }] }`. Use it for the role document dropdown and the admin library page. |
| `GET /api/documents/my-documents`                  | Any user                     | Documents this user can access, same item shape. Admin: every document. User: documents from all their roles, each once. A user with no roles gets `[]`.                       |
| `DELETE /api/documents/:docId`                     | Admin only                   | Deletes any document, whoever uploaded it. It disappears from every role. `409` while still processing.                                                                        |
| `GET /api/documents/get-all-parent-chunk/:docId`   | Users with access            | `404 Document not found` without access.                                                                                                                                       |
| `GET /api/documents/get-all-child-chunk/:parentId` | Users with access            | `404 Parent chunk not found` without access.                                                                                                                                   |
| `GET /api/documents/progress/:docId`               | Users with access            | `404 Document not found` without access.                                                                                                                                       |

- The "Knowledge base" sidebar module lists `my-documents`. Use it for every user, including the admin (it returns all documents for the admin).
- A document that was removed from the user's roles answers `404` on the next request. Remove it from the list and show "This document is no longer available".
- Empty state for a user with no roles: "No documents have been shared with you yet. Ask your admin for access."

## Steps 11-12: Chat follows roles (Implemented)

### `POST /api/chat` (SSE, unchanged stream format)

Body: `{ "question", "conversationId", "documentId"? }`

- `conversationId` is required and must be one of this user's conversations. Without `documentId` it must be a global conversation; with `documentId` it must be that document's conversation. Otherwise `404 { "error": "Conversation not found." }` (JSON, before any stream starts).
- With `documentId`: the user must have access, otherwise `404 { "error": "Document not found." }`. `202` while the document is processing, `500` if it failed (unchanged).
- Without `documentId` (global chat): the answer searches only the documents this user can access (admin: all). A user with no documents gets an answer saying nothing relevant was found.
- Sources and the "How this was answered" steps only ever cite accessible documents.

### Document chat: `GET /api/chat/conversation?documentId=` and `DELETE /api/chat/conversation?documentId=`

Unchanged shape. Both return `404 { "error": "Document not found." }` when the user has no access to that document.

## Steps 13-14: Multiple global chats (Implemented)

Global chats (like Claude): each has its own history and searches all documents the user can access.

| Method | Path                                      | Body           | Success                                                               |
| ------ | ----------------------------------------- | -------------- | --------------------------------------------------------------------- |
| GET    | `/api/chat/conversations`                 | none           | `200 [{ id, title, createdAt, updatedAt }]`, most recently used first |
| POST   | `/api/chat/conversations`                 | `{ "title"? }` | `201 { id, title, createdAt, updatedAt }`                             |
| GET    | `/api/chat/conversations/:conversationId` | none           | `200` conversation with messages                                      |
| PATCH  | `/api/chat/conversations/:conversationId` | `{ "title" }`  | `200 { id, title }`                                                   |
| DELETE | `/api/chat/conversations/:conversationId` | none           | `200 { "success": true }` (deletes the chat and its messages)         |

Conversation with messages (same shape as the document conversation response):

```json
{
  "id": "uuid",
  "userId": "uuid",
  "documentId": null,
  "type": "GLOBAL",
  "title": "Who approved the budget increase?",
  "createdAt": "...",
  "updatedAt": "...",
  "messages": [
    {
      "id": "uuid",
      "conversationId": "uuid",
      "role": "user",
      "content": "...",
      "metadata": null,
      "createdAt": "..."
    }
  ]
}
```

Assistant messages keep `metadata.citations`, `metadata.steps` and `metadata.reasoningChain` as before.

Flow:

1. "New chat" calls `POST /api/chat/conversations`, then opens the new id. Do not create a chat until the user clicks New chat (or sends the first question from an empty screen).
2. Each question: `POST /api/chat` with `{ question, conversationId }` and **no** `documentId`.
3. The first question becomes the title automatically (first 60 characters) when the title is still "New Conversation". Every question moves the chat to the top of the list (`updatedAt`), so refresh the list after an answer finishes.
4. Rename and delete from the chat list (confirm before delete).

Errors (`{ "error": "..." }`): `400 Title is required`, `400 Title is too long` (over 120 characters), `404 Conversation not found` (not this user's chat, or a document chat whose document the user can no longer access), `500 Something went wrong`. DELETE only deletes global chats; document chats are cleared with the document endpoint below.

### Document chat (one per user per document)

- `GET /api/chat/conversation?documentId=` gets or creates this user's chat for that document (with messages); `DELETE /api/chat/conversation?documentId=` clears its messages.
- `documentId` is now required: `400 { "error": "documentId is required; use /api/chat/conversations for global chats." }` without it. Do not use these endpoints for global chats any more.
- Ask with `POST /api/chat` and `{ question, conversationId, documentId }`.

Existing global chats from before this change appear in `GET /api/chat/conversations`.

## Web search approval: human in the loop (Implemented 14 November; Allow tested end to end, Skip not yet)

Before the assistant searches the public web, it asks the user. The answer run **pauses**, the UI shows Allow / Skip, and a second request continues the same run. This works in both global chats and document chats.

When it asks: only when the question needs outside facts that company documents cannot contain (for example a live exchange rate, a market price, a law). The planner marks those tasks as web tasks. The document search runs first; the pause comes after it, just before the answer. A question that needs only documents never pauses (same as before). A question that needs only the web pauses right away, without a document search. `webHops` always lists at least one task.

After **Allow**, a web research agent searches the web (and may read a page), then the answer combines document facts (cited as before) and web facts (with URL and date). After **Skip**, the answer uses only the documents and says which outside facts were not looked up.

### 1. Pause: new SSE event on `POST /api/chat`

The stream from `POST /api/chat` can now end with this event instead of answer tokens:

```json
{
  "type": "approval_required",
  "threadId": "uuid",
  "question": "What is the cost of project P11 in INR?",
  "webHops": [{ "id": "h2", "task": "find the live USD to INR exchange rate", "dependsOn": ["h1"], "source": "web" }],
  "message": "I need your approval to search the web before I answer."
}
```

followed by `{ "type": "done" }`. No `token` events are sent for a paused run.

UI:

- Stop the loading state and render an **approval card** in that assistant message: the `message` text, the list of `webHops[].task` as "What will be searched", a short note "Values found in your documents (for example an amount) may be included in the web search", and two buttons: **Allow web search** and **Skip**.
- Keep `threadId` with that message; the buttons need it.
- The user may also ignore the card and ask a new question; the paused run then stays paused.
- There is no backend "decide later" action. A "Decide later" button must only collapse or hide the card, with no API call; the message keeps `status: "awaiting_approval"`, so after a reload the card is shown again and Allow / Skip still work (also after a backend restart). An answer given later replaces that same message, so it appears at the message's original position.

### 2. Resume: `POST /api/chat/resume` (SSE)

Body:

```json
{ "conversationId": "uuid", "threadId": "uuid", "approved": true }
```

`approved` must be a boolean: `true` for Allow, `false` for Skip.

Errors are plain JSON, sent **before** any stream starts:

| Status | `error`                                                               | UI                                                                                |
| ------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 400    | `conversationId, threadId and approved (true or false) are required` | Bug in the request                                                                |
| 404    | `Conversation not found`                                              | Not this user's chat, or the document is no longer accessible                     |
| 404    | `No question is waiting for approval`                                 | Already answered or unknown `threadId`: reload the conversation                   |
| 409    | `This approval was already answered`                                  | Double click or another tab answered it: disable the buttons, reload the conversation |

On success the response is an SSE stream in the **same format as `POST /api/chat`**: first `{ "type": "approval_result", "threadId", "approved" }`, then the usual status/tool/trace events, `token` events with the answer, and `done`. An `error` event can arrive like on `POST /api/chat`.

UI:

- On click, disable both buttons and show the loading state in **the same assistant message**. Reuse the existing SSE reader from `POST /api/chat`.
- Stream the answer into that same message, replacing the approval card. The backend also replaces the waiting message in the database with the answer, so after a reload there is one assistant message, not two.
- If an `error` event arrives, show it in the message and re-enable the buttons: the backend puts the run back to waiting, so the user can try again.
- Refresh the chat list after `done` (as after a normal answer).

### 3. Saved messages after a reload

`GET /api/chat/conversations/:conversationId` and `GET /api/chat/conversation?documentId=` return the waiting message like any other assistant message, with this metadata:

```json
{
  "status": "awaiting_approval",
  "threadId": "uuid",
  "webHops": [],
  "steps": []
}
```

- `metadata.status === "awaiting_approval"`: render the approval card with Allow / Skip from `metadata.threadId` and `metadata.webHops`. A paused question can be resumed after a page reload or a backend restart.
- `metadata.status === "resuming"`: an answer is being generated (for example in another tab). Show "Answering..." with a Reload button; do not show Allow / Skip.
- A finished answer has no `status`. It keeps `citations`, `steps` and `reasoningChain`, and has `webApproval: true` (allowed) or `false` (skipped) when the user was asked.
- After Allow, the finished answer also has `webFacts` (see section 5).

### 4. "How this was answered" panel

- After a resume, `metadata.steps` holds the whole run: the events before the pause, then `approval_required`, `approval_result`, then the rest.
- Show `approval_required` as a step row "Asked to search the web" (list the `webHops` tasks), and `approval_result` as "User allowed web search" or "User skipped web search".
- The Question Splitter `tool_finish` event now also carries `webHops` (same shape as in `approval_required`). In the plan view, show document tasks from `hopPlan` as before and web tasks from `webHops` with a "Web" badge. `hopPlan` contains document tasks only.
- Web agent rows (section 5): one group per `agentId` ("Web research: <task>") with a row per `agent_step`, then that agent's result.

### 5. Web research agent (after Allow)

The resume stream sends these events between `approval_result` and the answer tokens. They are also saved in `metadata.steps`.

**One web research agent runs per web task, all at the same time.** Every agent event carries `agentId` (for example `web-h2`) and `hopId`; events of different agents arrive interleaved, so group them by `agentId`.

```json
{ "type": "agent_start", "agentId": "web-h2", "agent": "Web research", "hopId": "h2", "task": "find the current exchange rate from the currency in h1 to euros" }
```

```json
{ "type": "agent_step", "agentId": "web-h2", "agent": "Web research", "hopId": "h2", "step": 1, "tool": "tavily_search", "args": { "query": "USD to EUR exchange rate today", "max_results": 5 }, "ok": true, "mcpServer": "tavily" }
```

```json
{ "type": "agent_step", "agentId": "web-h2", "agent": "Web research", "hopId": "h2", "step": 2, "tool": "tavily_extract", "args": { "urls": ["https://..."] }, "ok": true, "mcpServer": "tavily" }
```

```json
{ "type": "agent_finish", "agentId": "web-h2", "agent": "Web research", "hopId": "h2", "stopReason": "done", "answer": "1 USD = 0.86 EUR (source URL, date)", "sources": ["https://...", "https://..."] }
```

- `agent_step`: one event per tool call; several can share the same `step` (an agent may run two searches at once). `ok: false` means that call failed; show it greyed out.
- Tool names (changed 17 November): the web agent now gets its tools from the Tavily MCP server. New runs send `tavily_search` and `tavily_extract`; saved older messages, and runs where the MCP server was unreachable (the backend falls back to built-in tools), send `web_search` and `read_page`. Map all four:
  - `tavily_search` or `web_search`: label "Web search", show `args.query`.
  - `tavily_extract`: label "Read page", show `args.urls` (an ARRAY of URLs) as links, one per line.
  - `read_page`: label "Read page", show `args.url` as a link.
  - Any other name: show the raw tool name and the args as compact JSON; never crash on an unknown tool (MCP servers can add tools).
- `mcpServer` (new, 17 November): the MCP server name (for example `"tavily"`) when the tool came from an MCP server, `null` for built-in tools; missing in older saved messages. When set, show a small badge after the label, for example "Web search [MCP · tavily]". Show no badge when it is null or missing.
- Running agents indicator: the latest-step text uses the same mapping: "Searching: <query>" for both search tools and "Reading: <first url>" for both read tools (for `tavily_extract` use `args.urls[0]`, plus "+N more" when there are several).
- `agent_finish.stopReason`: `done` (normal) or `step_limit` (the agent had to stop after 4 steps and answered with what it found). On failure the event is `{ "type": "agent_finish", "agentId": "...", "agent": "Web research", "hopId": "...", "failed": true, "reason": "..." }`; other agents continue and the answer still comes.
- `sources` are all pages that agent searched or read (not only the ones it used). Show them as a collapsible "Pages looked at" list per agent.

**Running agents indicator** (below the chat input, like "● 3 agents working"):

- Keep a set of running agents for the current message: add `agentId` on `agent_start`, remove it on `agent_finish`. Show the indicator while the set is not empty, with a pulsing green dot and the count ("● 1 agent working", "● 3 agents working").
- Clicking it expands a list: one line per agent with its `task` and its latest step ("Searching: <query>" / "Reading: <url>"); finished agents show a check mark (or a red mark when `failed`).
- Hide it on `done`. Rebuilt views (after reload) do not show the live indicator; the steps panel shows the saved agent groups.

Saved on the finished answer (`metadata.webFacts`, only after Allow), one result per agent:

```json
{
  "webFacts": {
    "searchedAt": "2026-11-14T09:30:00.000Z",
    "results": [
      { "hopId": "h2", "task": "find the current USD to EUR rate", "answer": "1 USD = 0.86 EUR according to https://... (14 Nov 2026)", "sources": ["https://..."], "stopReason": "done" },
      { "hopId": "h3", "task": "find the current USD to INR rate", "answer": "", "sources": [], "stopReason": "failed" }
    ]
  }
}
```

- Under the answer, show a small "Web sources" block: the `sources` links of all results (without duplicates) and "Searched on <date of searchedAt>". A result with `stopReason: "failed"` and an empty `answer` failed; show "Web search failed for: <task>".
- Web facts are cited in the answer text as a URL with a date, not as `[Source ID: ...]`. Document citations work as before. Do not turn web URLs into document citation chips; render them as normal links.

## Architecture diagram (Implemented 14 November)

`GET /api/architecture` (public, no token) returns an HTML page (`text/html`) with one dark-themed SVG diagram of the current system: chat API, CRAG pipeline (including web agents and the approval pause), pause and resume, upload pipeline, AI models and data stores. Names only; no text sections.

- Show it on the About page (or a new "Architecture" page) with an iframe: `<iframe src="${API_BASE_URL}/api/architecture" title="Architecture" style="width:100%; border:0; aspect-ratio: 1600 / 1240;">`. The page has its own styles and a dark background; the diagram scrolls sideways on narrow screens.
- Do not copy the SVG into the frontend; the backend file is the only copy and changes when the pipeline changes.
