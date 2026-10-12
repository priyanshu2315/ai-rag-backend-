import dotenv from "dotenv";
dotenv.config();

// Detect whether paid OpenCode model is active
const isOpenCode =
  process.env.AI_PROVIDER === "opencode" ||
  process.env.AI_AGENT_PROVIDER === "opencode";

/**
 * Central RAG Pipeline Configuration & Limits
 * Automatically scales limits when using paid OpenCode models,
 * falling back to standard limits for other providers.
 */
export const RAG_CONFIG = isOpenCode
  ? {
    // 1. Question Decomposition: Max sub-queries created by Question Splitter in crag.service.js
    MAX_SUB_QUERIES: 4,

    // 2. Vector Search: Top child sentences fetched via pgvector semantic matching in chat.repository.js
    SEARCH_VECTOR_MATCH_LIMIT: 30,

    // 3. Keyword Search: Top child sentences fetched via PostgreSQL ts_rank_cd full-text match in chat.repository.js
    SEARCH_KEYWORD_MATCH_LIMIT: 30,

    // 4. Search Candidates: Top RRF-merged parent paragraphs handed to the Cohere reranker in retrieveNode
    SEARCH_PARENT_CANDIDATES: 25,

    // 5. Cohere Reranker: Top-scoring chunks kept by reranker per query in ai.service.js / retrieveNode
    RERANK_TOP_N: 8,

    // 6. Round Safety Ceiling: Strict cap on total chunks collected per search round in getParentNeighbors
    MAX_TOTAL_CHUNKS_PER_ROUND: 16,

    // 7. Expansion Seeds: Top reranked chunks allowed to trigger neighbor/reference expansions in chat.repository.js
    EXPANSION_SEED_COUNT: 4,

    // 8. Cross-References: Max referenced sections/appendices followed (e.g. "Appendix B", resolutions) in chat.repository.js
    MAX_REFERENCE_CHUNKS: 4,

    // 9. Table Continuations: Max continuation parts pulled when a table splits across pages in chat.repository.js
    MAX_TABLE_CONTINUATION_CHUNKS: 4,

    // 10. Chapter / SOP Expansion: Max consecutive chunks pulled for full workflows/processes in chat.repository.js
    MAX_CHAPTER_EXPANSION_CHUNKS: 16,

    // 11. CRAG Retries / Multi-Hop: Max retrieval and grading retry rounds before forcing generation in crag.service.js
    MAX_CRAG_LOOPS: 6,

    // 12. Grader Fallback: Chunks kept if the Relevance Grader LLM call errors or times out in crag.service.js
    GRADER_FALLBACK_CHUNKS: 8,

    // 13. Generation Chunk Window: Max chunks passed into the final answer generation prompt in generateNode
    MAX_CONTEXT_CHUNKS: 16,

    // 14. Generation Character Limit: Max text characters fed to the final answer LLM (~8,000 tokens) in generateNode
    MAX_CONTEXT_CHARS: 32000,
  }
  : {
    // 1. Question Decomposition: Max sub-queries created by Question Splitter in crag.service.js
    MAX_SUB_QUERIES: 3,

    // 2. Vector Search: Top child sentences fetched via pgvector semantic matching in chat.repository.js
    SEARCH_VECTOR_MATCH_LIMIT: 20,

    // 3. Keyword Search: Top child sentences fetched via PostgreSQL ts_rank_cd full-text match in chat.repository.js
    SEARCH_KEYWORD_MATCH_LIMIT: 20,

    // 4. Search Candidates: Top RRF-merged parent paragraphs handed to the Cohere reranker in retrieveNode
    SEARCH_PARENT_CANDIDATES: 15,

    // 5. Cohere Reranker: Top-scoring chunks kept by reranker per query in ai.service.js / retrieveNode
    RERANK_TOP_N: 4,

    // 6. Round Safety Ceiling: Strict cap on total chunks collected per search round in getParentNeighbors
    MAX_TOTAL_CHUNKS_PER_ROUND: 10,

    // 7. Expansion Seeds: Top reranked chunks allowed to trigger neighbor/reference expansions in chat.repository.js
    EXPANSION_SEED_COUNT: 2,

    // 8. Cross-References: Max referenced sections/appendices followed (e.g. "Appendix B", resolutions) in chat.repository.js
    MAX_REFERENCE_CHUNKS: 2,

    // 9. Table Continuations: Max continuation parts pulled when a table splits across pages in chat.repository.js
    MAX_TABLE_CONTINUATION_CHUNKS: 2,

    // 10. Chapter / SOP Expansion: Max consecutive chunks pulled for full workflows/processes in chat.repository.js
    MAX_CHAPTER_EXPANSION_CHUNKS: 10,

    // 11. CRAG Retries / Multi-Hop: Max retrieval and grading retry rounds before forcing generation in crag.service.js
    MAX_CRAG_LOOPS: 3,

    // 12. Grader Fallback: Chunks kept if the Relevance Grader LLM call errors or times out in crag.service.js
    GRADER_FALLBACK_CHUNKS: 4,

    // 13. Generation Chunk Window: Max chunks passed into the final answer generation prompt in generateNode
    MAX_CONTEXT_CHUNKS: 10,

    // 14. Generation Character Limit: Max text characters fed to the final answer LLM (~4,000 tokens) in generateNode
    MAX_CONTEXT_CHARS: 16000,
  };
