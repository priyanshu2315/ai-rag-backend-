import { chatCompletion } from "../config/ai.js";

/**
 * Synthesizes a clean, human-readable step-by-step reasoning chain
 * for the Frontend modal and message metadata.
 */
export async function generateReasoningChain({
    question,
    answer,
    documents = [],
    subQueries = [],
    missingQuery = "",
}) {
    const passages = documents.map((doc, idx) => {
        const page = doc.metadata?.source_pages?.length
            ? doc.metadata.source_pages.join("-")
            : doc.metadata?.page_number != null
            ? String(doc.metadata.page_number)
            : "1";
        const section = (doc.metadata?.heading_path || []).join(" > ") || "General";
        const snippet = (doc.text || doc.searchText || "")
            .replace(/\r?\n/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 450);
        const origin = doc.retrievalOrigin || { type: "search" };

        let originLabel = "Keyword & Semantic Search Hit";
        if (origin.type === "chapter_expansion") originLabel = `Sequential Chapter Expansion (${origin.chapter || section})`;
        else if (origin.type === "reference_following") originLabel = `Cross-Reference Resolution (${origin.reference || "Reference"})`;
        else if (origin.type === "section_sibling") originLabel = "Adjacent Section Sibling";
        else if (origin.type === "section_lead") originLabel = "Section Header / Scope Table Lead";
        else if (origin.type === "table_continuation") originLabel = `Table Continuation (${origin.tableId})`;

        return {
            index: idx + 1,
            page,
            section,
            originLabel,
            text: snippet,
        };
    });

    const prompt = `You are a factual audit logger for a document search and reasoning engine.
Analyze the retrieval trace below and summarize the step-by-step reasoning chain into a clear, intuitive diagnostic breakdown for human inspection.

User Question: "${question}"
Final Answer: "${answer.slice(0, 800)}..."

Execution Trace:
- Queries Executed: ${(Array.isArray(subQueries) ? subQueries.join(" | ") : subQueries) || question}
${missingQuery ? `- Follow-up Multi-hop Query: "${missingQuery}"` : ""}

Retrieved Document Passages (${passages.length} total):
${passages
  .map(
    (p) =>
      `[Passage ${p.index}] Page: ${p.page} | Section: ${p.section} | Origin: ${p.originLabel}\nText: "${p.text}"`
  )
  .join("\n\n")}

CRITICAL AUDIT RULES:
1. NO THEORY & NO BOILERPLATE:
   - FORBIDDEN phrases: "Executed a query to locate relevant documents", "Followed the reference to verify...", "Identified seed hits", "Synthesized verified evidence", "to confirm details".
   - Keep "description" short, direct, and factual (e.g. 'Search: "..."', 'Cross-referenced: CFO Restatement Letter on Page 22', 'Retrieved FAT inspection record on Page 23').
2. GRANULAR FINDINGS PER PAGE:
   - In "findings", list the EXACT data, numbers, contract IDs, and facts discovered on EACH page.
   - Format:
     "• Page [X]: [Specific facts, numbers, dates, contract IDs, or rules discovered on that page]."
   - Never output generic statements like "Identified 3 hits" or just section names without their actual contents/numbers.
3. EXPLICIT CAUSAL LINK (Which fact created the next query/step):
   - If a discovered fact, code, rule, or contract triggered another follow-up query, reference lookup, or expansion, explicitly state:
     "• Trigger for next step: [Fact/Contract ID/Code X] discovered on Page [Y] triggered the follow-up lookup/search for [Z]."
4. SUMMARY:
   - Provide a direct, factual 1-2 sentence overview of what was resolved without meta-commentary.

Respond ONLY with valid JSON:
{
  "summary": "Direct, factual overview of what was resolved.",
  "steps": [
    {
      "step": 1,
      "type": "initial_search | neighbor_expansion | reference_following | multi_hop_search | synthesis",
      "title": "Clear, concise step title",
      "description": "Short direct action taken",
      "findings": "Per-page bullets with exact numbers/codes, followed by the trigger for the next step (if any)."
    }
  ]
}`;

    try {
        const res = await chatCompletion("fast", {
            messages: [{ role: "user", content: prompt }],
            temperature: 0,
            response_format: { type: "json_object" },
        });

        const parsed = JSON.parse(res.choices[0].message.content);
        if (parsed && Array.isArray(parsed.steps)) {
            return parsed;
        }
    } catch (err) {
        console.error("[ReasoningChain] Fast model failed, using deterministic fallback:", err.message);
    }

    // Deterministic fallback if model call fails
    const fallbackSteps = [];
    let idx = 1;

    if (passages.length > 0) {
        const pagesCovered = [...new Set(passages.map((p) => p.page))];
        const pageFindings = pagesCovered
            .map((pg) => {
                const docOnPage = passages.find((p) => p.page === pg);
                return `• Page ${pg} (${docOnPage.section}): ${docOnPage.text.slice(0, 180)}...`;
            })
            .join("\n");

        fallbackSteps.push({
            step: idx++,
            type: "initial_search",
            title: "Document Retrieval & Verification",
            description: `Searched: "${(Array.isArray(subQueries) ? subQueries.join(", ") : subQueries) || question}"`,
            findings:
                pageFindings +
                (missingQuery
                    ? `\n• Trigger for next step: Discovered initial facts, triggering follow-up query: "${missingQuery}"`
                    : ""),
        });
    }

    if (missingQuery) {
        fallbackSteps.push({
            step: idx++,
            type: "multi_hop_search",
            title: "Multi-Hop Evidence Follow-Up",
            description: `Follow-up search: "${missingQuery}"`,
            findings: `Retrieved additional supporting facts to finalize answer.`,
        });
    }

    return {
        summary: `Retrieved ${passages.length} verified passage(s) across page(s) ${[...new Set(passages.map((p) => p.page))].join(", ")}.`,
        steps: fallbackSteps,
    };
}
