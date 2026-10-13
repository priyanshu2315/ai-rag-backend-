# Frontend Integration Prompt: Reasoning Chain, Chapter Expansion & Document Outline (Chat & Ingestion v6)

Update our existing frontend to support the latest features added to the ingestion and chat pipelines. Inspect the frontend code first. Use its existing framework, API client, authentication, components, design system, and styling. Implement the integration and relevant tests. Do not invent backend endpoints or fields.

This specification builds upon our previous frontend integration prompts and specifies **all features and changes developed after them**:
1. **The `reasoningChain` Diagnostic Object**:
   - Delivered live via SSE event `type: "reasoning_chain"`.
   - Persisted in PostgreSQL and returned via `GET /api/chat/conversation` in `message.metadata.reasoningChain`.
   - Provides a human-readable high-level summary and granular step-by-step audit findings with per-page bullets and multi-hop triggers.
2. **New Retrieval Origin: `chapter_expansion`**:
   - Added for SOPs, procedures, workflows, and policy questions.
   - Pulls sequential chunks from the same root chapter (`retrievalOrigin: { type: "chapter_expansion", seedParentId, chapter }`).
3. **Table of Contents Document Outline (`documentOutline`)**:
   - Extracted from document contents pages and attached to document data.
   - Array of `{ sectionCode, title, targetPage, pageCount }` enabling document navigation and outline jumping.
4. **Reading Guide & Navigation Reference Following**:
   - Seed chunks from "Reading Guides" or "Where to Find What" tables automatically resolve referenced target sections.
5. **Provider-Scaled Pipeline Limits (`RAG_CONFIG`)**:
   - The system dynamically scales retrieval limits (up to 16 chunks context / 32,000 characters when power models are active; 10 chunks / 16,000 characters on standard mode). The UI must handle up to 16 chunks smoothly.

---

## 1. NEW DATA SCHEMAS & INTERFACES

### 1.1 The `reasoningChain` Schema (`types/chat.ts`)

```typescript
export type ReasoningStepType =
  | "initial_search"
  | "neighbor_expansion"
  | "reference_following"
  | "multi_hop_search"
  | "synthesis"
  | string;

export interface ReasoningStep {
  step: number;
  type: ReasoningStepType;
  title: string;
  description: string;
  findings: string; // Multiline bullet points with exact facts, numbers, and causal triggers
}

export interface ReasoningChain {
  summary: string;
  steps: ReasoningStep[];
}
```

### 1.2 Updated `ChatMessage` and `MessageMetadata`

When calling `GET /api/chat/conversation`, assistant messages now return:

```typescript
export interface MessageMetadata {
  citations?: Citation[];
  steps?: Array<any>; // Raw execution trace events
  reasoningChain?: ReasoningChain | null; // Structured human-readable reasoning audit
  totalTokens?: number;
  totalCostINR?: number;
  formattedTotalCost?: string;
  [key: string]: unknown;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: MessageMetadata | null;
  createdAt: string;
}
```

### 1.3 Updated Retrieval Origin (`retrievalOrigin`)

Chunks in `retrieval_candidates`, `retrieved_chunks`, `neighbor_expansion`, `generation_context`, and `citations` now support **5 distinct origin types**:

```typescript
export type RetrievalOrigin =
  | {
      type: "search";
    }
  | {
      type: "chapter_expansion"; // 👈 NEW: sequential chapter workflow
      seedParentId: string;
      chapter: string; // e.g. "Section 04 - Technical Architecture"
    }
  | {
      type: "section_sibling";
      seedParentId: string;
      sectionId: string;
    }
  | {
      type: "section_lead";
      seedParentId: string;
      sectionId: string;
    }
  | {
      type: "table_continuation";
      seedParentId: string;
      tableId: string;
    }
  | {
      type: "reference_following";
      seedParentId: string;
      reference: string; // e.g. "Resolution 2025-14", "Appendix C"
    };
```

### 1.4 Document Outline Schema (`documentOutline`)

In document metadata (`GET /api/documents/my-documents` and document chunk endpoints):

```typescript
export interface DocumentOutlineEntry {
  sectionCode: string; // e.g. "Appendix B", "SECTION-4", "TN-1"
  title: string;       // e.g. "Board Minutes of 22 October 2025"
  targetPage: number | null; // 1-indexed PDF page number
  pageCount: number | null;
}

export interface DocumentDetails {
  id: string;
  filename: string;
  fileUrl: string;
  status: string;
  summaryStatus: string;
  documentOutline?: DocumentOutlineEntry[] | null; // 👈 NEW: Extracted Table of Contents
  // ... other document fields
}
```

---

## 2. SSE STREAM EVENT UPDATES (`POST /api/chat`)

Handle the new live `reasoning_chain` event alongside existing events:

| SSE Event `type` | Payload Fields | Description |
| :--- | :--- | :--- |
| `reasoning_chain` | `reasoningChain` (`{ summary, steps }`) | Emitted immediately after answer synthesis. Contains the structured human-readable audit chain. |
| `citations` | `citations` (`Array<Citation>`) | Emitted before token stream with resolved file URLs, page numbers, and offsets. |
| `retrieved_chunks` | `count`, `chunks` (`Array<ParentChunk>`) | Emitted with candidate chunks and their `retrievalOrigin`. |
| `step_cost` | `step`, `model`, `tokens...`, `costINR`, `formattedINR` | Per-step billing calculation in INR. |
| `total_usage_summary` | `totalTokens`, `totalCostINR`, `formattedTotalCost`, `breakdown` | Full query billing summary. |
| `token` | `text` | Streamed answer text. |
| `done` | – | Stream complete. |

---

## 3. FRONTEND UI REQUIREMENTS

### 3.1 Reasoning Chain Trigger & Modal / Drawer (`reasoningChain`)
1. **Trigger Button**:
   - On every assistant message where `message.metadata.reasoningChain` exists (or when received live):
   - Render a styled button: `🧠 Reasoning Chain (${steps.length} steps)`.
2. **Modal / Slide-Over Drawer View**:
   - **Summary Banner**: Displays `reasoningChain.summary` in a highlighted overview card.
   - **Step-by-Step Timeline**:
     - Icons:
       - `initial_search`: 🔍 Search Retrieval
       - `chapter_expansion`: 📖 Chapter / Workflow Expansion
       - `neighbor_expansion`: 📄 Context Expansion
       - `reference_following`: 🔗 Cross-Reference Resolution
       - `multi_hop_search`: 🔄 Multi-Hop Follow-up
       - `synthesis`: 🧠 Answer Grounding
     - Each card displays `stepItem.title`, `stepItem.description`, and `stepItem.findings`.
   - **Multiline Findings Rendering (`white-space: pre-line`)**:
     - `stepItem.findings` contains structured per-page bullets:
       ```text
       • Page 4: Operating cost 4,120 K TC for Depot D08.
       • Page 9: Resolution 2025-14 restates fiscal 2023 figures.
       • Trigger for next step: Discovered contract VS-GRID-0417 on Page 4 triggering lookup...
       ```
     - Style `.findings-content` with `white-space: pre-line;` so bullets render on separate lines.
     - **Visual Causal Link**: If a bullet contains `"Trigger for next step:"`, style it as an accent callout with an arrow (`↳`) to emphasize the multi-hop connection.

### 3.2 Displaying `chapter_expansion` Retrieval Origin
In the Evidence Inspector, Chunk Drawer, and Citation tooltips:
- When `chunk.retrievalOrigin.type === "chapter_expansion"`:
- Render a distinct teal/indigo badge: `📖 Chapter: ${origin.chapter}`.
- Tooltip: *"Pulled as part of sequential workflow or procedure in ${origin.chapter}"*.

### 3.3 Document Outline Navigation (`documentOutline`)
In the document viewing panel or chunk inspector:
- If `document.documentOutline` is present and non-empty:
- Render a collapsible **"Document Outline"** or **"Contents"** sidebar tab.
- List each section with its `sectionCode`, `title`, and `targetPage`.
- Clicking an entry jumps the PDF viewer directly to `targetPage`.

### 3.4 Scaled Context Capacity (Up to 16 Chunks)
- The backend may now return up to 16 chunks in `retrieved_chunks` and `generation_context` (and up to 6 CRAG retrieval loops).
- Ensure the Evidence Inspector list and Reasoning Stepper scroll cleanly and support up to 16 chunks without UI lag or overflow bugs.

---

## 4. TESTS & VERIFICATION

Implement focused tests covering:
1. **`reasoning_chain` Event & Metadata**:
   - Verify that receiving `{ type: "reasoning_chain", reasoningChain: { summary, steps } }` attaches it to active message state.
   - Verify that loading conversation history (`GET /api/chat/conversation`) renders the "Reasoning Chain" button from `message.metadata.reasoningChain`.
   - Verify multiline rendering of `findings` with `white-space: pre-line`.
2. **`chapter_expansion` Origin**:
   - Verify rendering of `chapter_expansion` badge and chapter label.
3. **`documentOutline` Display**:
   - Verify that documents with `documentOutline` render the interactive Table of Contents outline.
   - Verify clicking an outline item triggers the page jump handler with `targetPage`.
4. **High-Chunk Scalability**:
   - Test rendering an evidence drawer with 16 chunks to confirm layout and scrolling remain fluid.

---

## 5. DELIVERABLE

Implement the `ReasoningChainViewer` component, `chapter_expansion` badge styling, document outline sidebar, and updated SSE event handlers. Run and report all unit/integration test results. Report all changed files and components.
