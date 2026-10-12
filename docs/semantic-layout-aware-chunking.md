# Semantic Layout-Aware Chunking Architecture

## 1. Executive Summary & Mental Model

Traditional RAG systems split documents using naive character- or word-count windows (e.g., 500 characters with 50-character overlap). This approach fails on complex enterprise documents:
* **Table Destruction:** Tables are sliced mid-row, separating numbers from column names, units, and dates.
* **Context Dilution:** Vectors from large chunks blur multiple ideas together; vectors from small chunks lack necessary surrounding context.
* **Structural Blindness:** Document hierarchies (titles, sections, subsections) and cross-page continuations are lost.

Our platform implements a **Semantic Layout-Aware Chunking Pipeline**. It preserves document layout, reconstructs cross-page tables, and generates a **hierarchical parent–child chunk structure** enriched with global section breadcrumbs.

```
Uploaded Document (PDF / DOCX)
          │
          ▼
[1. Multimodal Extraction] ──▶ Raw digital text (pdf.getText) + Page screenshots (pdf.getScreenshot)
          │                   Processed in 4-page batches with Gemini Vision
          ▼
[2. AST Sectioning]        ──▶ Unified Markdown AST (remark-parse + remark-gfm)
          │                   Heading stack (# Title, ## Section, ### Subsection)
          │                   Suffix stripping ("(continued)") & Section Resumption
          ▼
[3. Table Processing]      ──▶ Row denormalization (Key-Value representation)
          │                   Cross-page sequential table stitching (numberedRowKey)
          ▼
[4. Contextual Chunking]   ──▶ Parent chunks (≤1024 tokens) & Child chunks (≤256 tokens)
          │                   Contextual SearchText prefix (Anthropic Contextual Retrieval pattern)
          ▼
[5. Relational Persistence]──▶ PostgreSQL (pgvector) + reading order (prev/next) & table continuation links
```

---

## 2. Deep Dive: Table Continuation Logic

Tables represent one of the most failure-prone components in document AI. Documents routinely split tables across page boundaries, abbreviate continuation headers, or interrupt tables with intervening sections.

### The Problem
Consider this real-world scenario from `Chunking_Stress_Test_Document.pdf`:
1. **Page 3:** Section 5 contains a financial table with rows `D01` to `D07` with full column headers:
   `| Depot Code and Name | Column A — fiscal 2022 operating cost (K TC) | Column B — fiscal 2023 revenue (K TC) |`
2. **Page 3 (Bottom):** Section 6 interrupts with `## 6. PALLET AND LOAD UNIT STANDARDS` (prose rules).
3. **Page 4:** Section 5 resumes with rows `D08` to `D12`, but uses shorthand column headers:
   `| Depot Code and Name | Column A | Column B |`

Naive chunkers treat Page 4 as an isolated table with undefined column headers `Column A` and `Column B`.

---

### The Two-Tier Solution

#### Step A: Row Denormalization (`blockPassages`)
In [src/services/simple-chunking.service.js](file:///c:/Users/priya/Desktop/Ai%20Rag/src/services/simple-chunking.service.js#L197-L215), raw Markdown table rows are converted into self-contained key-value passages:

```javascript
function blockPassages(block) {
  if (block.type !== "table") return [{ text: block.text, block }];
  const [header, ...rows] = block.node.children;
  if (!rows.length) return [{ text: block.text, block }];
  const labels = (block.tableLabels ?? header.children.map((cell) => inlineText(cell).trim()))
    .map((label, index) => label || "Column " + (index + 1));
  return rows.map((row, index) => {
    const fields = row.children.map((cell, column) => ({
      label: labels[column] ?? "Column " + (column + 1),
      value: inlineText(cell),
    }));
    return {
      block,
      rowId: block.id + "/row-" + (index + 1),
      fields,
      rowIdentity: fields[0].label + ": " + fields[0].value,
      text: fields.map((field) => field.label + ": " + field.value).join("\n"),
    };
  });
}
```

*Raw Markdown Row:*
`| D01 Alderbank Yard | 3,880 | 6,410 | 3,905 |`

*Denormalized Passage:*
```text
Depot Code and Name: D01 Alderbank Yard
Column A — fiscal 2022 operating cost (K TC): 3,880
Column B — fiscal 2023 revenue (K TC): 6,410
Column C — fiscal 2023 operating cost (K TC): 3,905
```
Every individual row becomes an independent semantic entity that preserves its metric names, units, and dates.

---

#### Step B: Cross-Page Table Stitching (`splitMarkdownSections`)

When an AST table node is encountered on a new page, the system attempts to link it to an existing table using two algorithms:

```javascript
// 1. Extract alphanumeric row keys from cell text (e.g. "D07", "D08 Tollwick Hub II")
function numberedRowKey(value) {
  const match = value.trim().match(/^([\p{L}]+)[\s-]*(\d{1,6})(?:[^\p{L}\p{N}]|$)/u);
  return match ? { prefix: match[1].toLowerCase(), number: Number(match[2]) } : null;
}

// 2. Check if next row number immediately increments previous row number
function continuesNumberedRows(previous, next) {
  return previous && next && previous.prefix === next.prefix &&
    next.number === previous.number + 1;
}

// 3. Verify column label compatibility across shorthand and full headers
function compatibleTableLabels(previous, next) {
  if (previous.length !== next.length) return false;
  return previous.every((label, index) => {
    const before = label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const after = next[index].toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!before || !after) return false;
    return before === after || before.startsWith(after + " ") ||
      after.startsWith(before + " ") ||
      (index >= 2 && before.startsWith("column " + after + " "));
  });
}
```

#### The Candidate Matching Pipeline:
1. **Scope Candidate Pool:**
   Filter all tracked tables:
   * Must have the same column count (`candidate.labels.length === labels.length`).
   * Must have appeared within the last 2 pages (`candidate.pageIndex >= page.sequenceIndex - 2`).
2. **Strategy 1: Sequential Row Key Match (`match: "row_sequence"`):**
   * Checks if candidate's `lastRowKey` (e.g., `D07`) is incremented by current table's `firstRowKey` (e.g., `D08`).
   * Verifies column compatibility via `compatibleTableLabels` (e.g., matching `"Column A"` with `"Column A — fiscal 2022 operating cost (K TC)"`).
3. **Strategy 2: Exact Column Match Fallback (`match: "column_headers"`):**
   * If rows are not numbered (e.g. cities or dates), checks if the column header signature matches an existing table exactly.
4. **Context Propagation:**
   When a match is found:
   * Sets `table.continued = true`.
   * Reuses the original `table.id` (e.g., `"table-1"`).
   * Passes `table.labels` (the full column definitions from Page 3) to `block.tableLabels`, so Page 4's rows inherit the full header descriptions.
   * Records metadata relationship:
     ```json
     {
       "type": "table_continuation",
       "table_id": "table-1",
       "from_page": 3,
       "to_page": 4,
       "match": "row_sequence"
     }
     ```

---

## 3. End-to-End Pipeline Stages

### Stage 1: Multimodal Extraction & Batching
* **File:** [src/services/ai.service.js](file:///c:/Users/priya/Desktop/Ai%20Rag/src/services/ai.service.js)
* **Digital Text Stream:** `pdf.getText()` extracts exact characters directly from the PDF stream to prevent vision OCR from dropping fine print or misreading dense numbers.
* **Visual Screenshots:** `pdf.getScreenshot()` renders 1600px JPEG page images.
* **4-Page Batches:** Pages are batched in groups of 4 to avoid hitting LLM output token limits (4,096 to 8,192 tokens max) and prevent latency timeouts.
* **Normalization Prompt:** Enforces single `# Document Title`, stripping repeated running headers, logos, and page footers.

### Stage 2: AST Sectioning & Structural Analysis
* **File:** [src/services/simple-chunking.service.js](file:///c:/Users/priya/Desktop/Ai%20Rag/src/services/simple-chunking.service.js)
* **AST Parser:** Uses `unified`, `remark-parse`, and `remark-gfm` to parse page markdown into typed AST nodes (`heading`, `table`, `paragraph`, `list`).
* **Heading Stack:** Maintains breadcrumbs where `#` is Document Title, `##` is Section, and `###` is Subsection.
* **Suffix Stripping:** Removes `(continued)` / `(cont.)` suffixes so continuation pages don't fracture a section into disconnected IDs.
* **Section Resumption:** When an interrupted section resumes after another section, the chunker reuses the existing `section_id` instead of generating a new one.

### Stage 3: Hierarchical Parent–Child Chunking
* **Parent Chunks (Context Units):** Capped at 1,024 tokens. Formed along page boundaries or when the token budget is reached.
* **Child Chunks (Search Units):** Capped at 256 tokens.
* **Tokenizer Enforcement:** Tokens are measured against the real `Xenova/all-MiniLM-L6-v2` tokenizer via `measureEmbeddingInput`, throwing explicit errors on oversized chunks rather than silently truncating.
* **Contextual SearchText (Anthropic Pattern):** Each child chunk receives a deduplicated prefix:
  ```text
  Document: DEPOT HANDBOOK TPN-SH-2026-10

  Section: 5. DEPOT FINANCIAL RECORD, FISCAL 2022 AND FISCAL 2023

  Depot Code and Name: D01 Alderbank Yard
  Column A — fiscal 2022 operating cost (K TC): 3,880
  ...
  ```
  This grounds isolated passages in global document identity for high-precision vector and keyword retrieval.

### Stage 4: Relational Graph-like Retrieval (Neighbor Expansion)
* **File:** [src/repositories/chat.repository.js](file:///c:/Users/priya/Desktop/Ai%20Rag/src/repositories/chat.repository.js#L246-L298)
* **Linear Reading Order:** Parents link `prevParentId` and `nextParentId` within the same section.
* **Table Traversal:** Chunks link `metadata.linked_table_ids`.
* **Search Expansion:** When vector search retrieves a child chunk, the system resolves its parent and executes `getParentNeighbors`. It pulls:
  1. Continuing table chunks (`linked_table_ids: ["table-1"]`).
  2. Immediate reading order neighbors (`prevParentId` and `nextParentId`).
  This supplies the complete answer context to the LLM without requiring a graph database.

---

## 4. Metadata Schema Reference

| Metadata Key | Type | Description |
| :--- | :--- | :--- |
| `document_title` | `string` | Canonical title of the document. |
| `document_identity` | `object` | `{ filename, title, status, titleSource }`. |
| `section_id` | `string` | Identifier for the section (reused across interrupted pages). |
| `heading_path` | `string[]` | Active breadcrumb path (e.g. `["5. Financial record"]`). |
| `heading_paths` | `string[][]` | Array of all subsection paths contained inside this parent chunk. |
| `page_number` | `number` | Primary source page number (1-indexed). |
| `source_pages` | `number[]` | Array of all pages contributing content to this chunk. |
| `source_locations` | `object[]` | Start and end character offsets in the page Markdown for UI citations. |
| `block_ids` | `string[]` | AST block IDs included in this chunk (`["block-18", "block-19"]`). |
| `block_types` | `string[]` | Types of AST blocks (`["table"]`, `["paragraph"]`). |
| `table_ids` | `string[]` | ID of any table present in this chunk (`["table-1"]`). |
| `linked_table_ids` | `string[]` | ID of table continuations linked across pages (`["table-1"]`). |
| `relationships` | `object[]` | Explicit links (`table_continuation`, `row_sequence`). |
| `row_ids` | `string[]` | IDs of table rows inside (`["block-18/row-1", ...]`). |
| `token_budget` | `object` | Measured `{ tokenCount, tokenLimit, withinLimit }`. |
| `embedding` | `object` | Child-only: `{ model, dimensions: 384, tokenCount, withinLimit }`. |

---

## 5. Technical Interview Pitch

If asked: *"How do you handle semantic layout-aware chunking in your RAG pipeline?"*

> *"We built a multi-stage, layout-aware pipeline rather than naive character splitting:
> 
> 1. **Multimodal Extraction:** We extract digital text using `pdf-parse` alongside page screenshots, processing them in 4-page batches with Gemini to eliminate OCR dropouts and stay within output token limits.
> 2. **AST Parsing & Section Continuity:** We parse page Markdown into an Abstract Syntax Tree using `unified` and `remark-gfm`. We track heading stacks where `#` is document title, `##` is main section, and `###` is subsection. Suffixes like `(continued)` are stripped, and interrupted sections resume under their original `section_id`.
> 3. **Layout-Aware Table Stitching:** Tables are denormalized into key-value pairs repeating column headers, units, and dates for every row. When tables span pages, our `numberedRowKey` algorithm matches sequential primary keys (e.g. `D07` $\rightarrow$ `D08`), links both halves under the same `table_id`, and propagates full column definitions to continuation pages.
> 4. **Hierarchical Parent–Child Chunking:** We generate 1,024-token Parents for context and 256-token Children for search, verified with our local MiniLM tokenizer. Children are enriched with contextual `Document:` and `Section:` prefixes before embedding.
> 5. **Relational Neighbor Expansion:** At search time, hits resolve to their parents and expand via `prevParentId`, `nextParentId`, and `linked_table_ids`, giving the generator complete narrative and tabular context without the overhead of a dedicated graph database."*
