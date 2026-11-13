/**
 * The engineering timeline behind DocuMind, reviewed 9 November 2026.
 * Earlier entries describe historical stages, not guarantees about the current
 * implementation. The November entries record the latest search, history,
 * grading, planning, access-control and email behavior.
 *
 * Content only: the About page renders it and holds no copy of its own, so a
 * new phase is one entry here rather than an edit to the markup.
 */
export const PIPELINE = [
  {
    id: 1,
    title: "Inference Offloading & Compute Decoupling",
    problem:
      "I started with a local LLM instance using Ollama, but local hardware constraints caused severe inference bottlenecks, high latency, and restricted model parameter size.",
    solution:
      "I decoupled compute from local hardware by migrating to Groq's high-throughput LPU API infrastructure. This enabled sub-second Time-to-First-Token (TTFT) and unlocked higher-parameter models without infrastructure strain.",
    terms: [
      "Inference Offloading",
      "Compute Decoupling",
      "Time-to-First-Token (TTFT)",
      "Hardware Bottleneck Mitigation",
    ],
    date: "August 22, 2026",
  },
  {
    id: 2,
    title: "Vector Dilution & Granularity Loss",
    problem:
      "I initially chunked documents strictly by macro-paragraphs. Generating a dense vector embedding for an entire large paragraph caused the vector to represent only the dominant macro-topic, mathematically diluting minute facts (e.g., a single line about a laptop policy buried inside a general leave policy paragraph).",
    solution:
      "I identified the need for fine-grained chunking so that individual sentences retain high semantic distinctiveness in high-dimensional vector space.",
    terms: [
      "Vector Dilution",
      "Dense Semantic Embedding Space",
      "Semantic Smearing",
      "High-Dimensional Spatial Averaging",
    ],
    date: "August 22, 2026",
  },
  {
    id: 3,
    title: "Parent-Child Chunking (Small-to-Big Retrieval)",
    problem:
      "Splitting text into isolated small sentences solved vector dilution but stripped the LLM of necessary surrounding context during generation.",
    solution:
      'I implemented a Parent-Child (Small-to-Big) architecture. I store fine-grained, sentence-level "child chunks" for precise cosine similarity matching (pgvector), while mapping each child to its larger "parent chunk" (the full paragraph). When a child matches a query, I retrieve and inject the parent paragraph into the prompt context.',
    terms: [
      "Parent-Child Chunking",
      "Small-to-Big Retrieval",
      "Sentence-Window Indexing",
      "Contextual Window Expansion",
    ],
    date: "September 6, 2026",
  },
  {
    id: 4,
    title: "Vocabulary Mismatch & Semantic Clumping on Exact Identifiers",
    problem:
      "Dense vector embeddings map conceptual meaning rather than exact character sequences. When searching for exact error codes (e.g., err-404), policy IDs, or part numbers, vector search struggled due to sub-word tokenization and semantic clumping (grouping err-404 with general, unrelated error concepts).",
    solution:
      "I identified that exact alphanumeric lookups require sparse lexical retrieval rather than purely semantic cosine distance.",
    terms: [
      "Vocabulary Mismatch Problem",
      "Semantic Clumping",
      "Sub-word Tokenization Artifacts",
      "Dense vs. Sparse Retrieval Mismatch",
    ],
    date: "August 25, 2026",
  },
  {
    id: 5,
    title: "Hybrid Search & Reciprocal Rank Fusion (RRF)",
    problem:
      "Pure vector search fails on exact keywords, while pure keyword search fails on semantic intent.",
    solution:
      "I implemented a two-pronged Hybrid Search engine in PostgreSQL. I query 15 candidate child chunks via dense vector search (pgvector cosine distance) and 15 candidate child chunks via sparse lexical search (PostgreSQL BM25 via to_tsvector and ts_rank_cd). I merge and score these results inside a PostgreSQL Common Table Expression (CTE) using Reciprocal Rank Fusion (RRF: Score = ∑ 1 / (60 + rank)), extracting the top 5 highest-ranking distinct parent paragraphs.",
    terms: [
      "Hybrid Search Fusion",
      "Lexical/BM25 Matching (tsvector/ts_rank_cd)",
      "Dense Vector Search (pgvector)",
      "Reciprocal Rank Fusion (RRF)",
      "Common Table Expressions (CTEs)",
    ],
    date: "August 25, 2026",
  },
  {
    id: 6,
    title: "Lexical Indexing & Database Optimization",
    problem:
      "Full-text keyword scans and ranking over raw chunk text introduced database sequential-scan overhead as data volume grew.",
    solution:
      "I implemented Generalized Inverted Indexes (GIN) on the document text expressions alongside B-Tree indexing on foreign keys (documentId, parentId), ensuring sub-millisecond retrieval execution during hybrid search joins.",
    terms: [
      "GIN Indexing (Generalized Inverted Index)",
      "Full-Text Search Indexing",
      "Query Optimization",
      "Execution Plan Pruning",
    ],
    date: "August 25, 2026",
  },
  {
    id: 7,
    title: "Two-Stage Retrieval & Cross-Encoder Re-Ranking",
    problem:
      'Passing all top 5 retrieved parent chunks directly into the LLM context consumed excessive tokens and exposed the model to the "Lost in the Middle" phenomenon (where LLMs overlook facts placed in the center of large context blocks).',
    solution:
      "I implemented a Two-Stage Retrieval pipeline. After Hybrid Search and RRF narrow the field down to the top 5 parent chunks, I route those 5 chunks through a Cohere Cross-Encoder re-ranking model (rerank-v3.0). The Cross-Encoder scores full query-document semantic interactions and eliminates the bottom 2 chunks, passing only the absolute top 3 most relevant parent chunks to the generation LLM.",
    terms: [
      "Two-Stage Retrieval Pipeline",
      "Cross-Encoder Re-ranking",
      "Bi-Encoder vs. Cross-Encoder",
      "Lost-in-the-Middle Phenomenon",
      "Prompt Context Optimization",
    ],
    date: "September 6, 2026",
  },
  {
    id: 8,
    title: "Semantic Query Routing & Intent Classification",
    problem:
      'The system executed expensive database retrievals indiscriminately for all user inputs, including basic chit-chat ("Hello") or document-wide requests ("Summarize this file").',
    solution:
      "I integrated a pre-retrieval Dual-Model Router using a fast, low-latency model (openai/gpt-oss-20b) with Structured JSON Mode. The router classifies incoming queries into GREETING, GLOBAL_SUMMARIZE, or SEARCH, bypassing the vector database entirely when retrieval is not required.",
    terms: [
      "Semantic Query Routing",
      "Intent Classification",
      "Dual-Model Orchestration",
      "Structured JSON Schema Enforcement",
    ],
    date: "September 6, 2026",
  },
  {
    id: 9,
    title: "Stateful Conversational Persistence",
    problem:
      "Standard RAG pipelines are stateless, preventing users from maintaining multi-turn conversations or referencing prior answers.",
    solution:
      "I designed a relational PostgreSQL persistence layer (Conversation and Message models via Prisma). By making documentId nullable, the architecture cleanly supports both document-scoped chat sessions and workspace-wide global search threads.",
    terms: [
      "Stateful Multi-Turn Architecture",
      "Relational Session Persistence",
      "Scoped vs. Global Contextual Memory",
    ],
    date: "September 6, 2026",
  },
  {
    id: 10,
    title: "Coreference Resolution & Pre-Retrieval Query Reformulation",
    problem:
      'In conversational threads, users frequently use pronouns or contextual ellipsis (e.g., asking "What about in manufacturing?" after discussing compliance rules), causing standalone vector searches to fail completely.',
    solution:
      "When user intent is classified as SEARCH, I route the user prompt and recent chat history through the fast model to perform Coreference Resolution. This reformulates the vague follow-up into a standalone, context-complete search query before querying the database.",
    terms: [
      "Coreference Resolution",
      "Query Reformulation / Rewriting",
      "Conversational Context Expansion",
      "Pronoun Disambiguation",
    ],
    date: "September 6, 2026",
  },
  {
    id: 11,
    title: "Ingestion-Time Map-Reduce Summarization & Cascading Batching",
    problem:
      'Standard RAG cannot answer global queries (e.g., "Summarize this document") because similarity search only fetches isolated chunks. Conversely, passing an entire 100k-token document at query time triggers rate limits and context window overflows.',
    solution:
      "I moved global summarization to an asynchronous BullMQ/Redis worker during document upload. I built a dynamic Token-Budget Batching system using byte-pair encoding (gpt-tokenizer) with a Cascading Fallback Strategy (paragraph → sentence → character slicing) to handle unformatted text safely. The worker executes a Map-Reduce pipeline—generating batch summaries and synthesizing them into a master summary stored directly in PostgreSQL for instant, zero-latency streaming.",
    terms: [
      "Map-Reduce Summarization Pattern",
      "Asynchronous Worker Decoupling (BullMQ/Redis)",
      "Token-Budget Batching (BPE)",
      "Cascading Fallback Strategy",
      "Ingestion-Time Pre-computation",
    ],
    date: "September 6, 2026",
  },
  {
    id: 12,
    title: "Agentic ReAct Architecture & Autonomous Tool Calling",
    problem:
      "Linear RAG pipelines fail on multi-hop queries where information is scattered. The LLM only gets one chance to search, often failing to answer if the initial retrieval lacks complete context.",
    solution:
      "Transitioned the LLM into an autonomous manager using a ReAct (Reasoning + Action) loop. By equipping the 120B model with strict JSON tool schemas (search_corporate_database, get_document_summary), the Agent can now execute targeted hybrid searches, evaluate the retrieved chunks, and autonomously trigger follow-up searches to hunt down missing dependencies before streaming the final answer.",
    terms: [
      "Agentic RAG",
      "ReAct Loop (Reasoning + Action)",
      "Multi-Hop Reasoning",
      "Autonomous Tool Calling",
    ],
    date: "September 6, 2026",
  },
  {
    id: 13,
    title: "RAGOps, Observability & LLM-as-a-Judge Evaluation",
    problem:
      'With the LLM acting autonomously inside a recursive loop, the system becomes a "black box." It is nearly impossible to manually debug whether a poor response was caused by a hallucination, a vector retrieval miss, or an incorrect tool selection.',
    solution:
      "Integrated LangSmith using the traceable SDK wrapper to map the entire ReAct execution tree visually in real-time. Built an automated testing suite using an LLM-as-a-Judge pattern against a Golden Dataset to score the Agent continuously on Faithfulness and Correctness metrics, treating prompt and chunking tweaks like standard CI/CD unit tests.",
    terms: [
      "Observability & Tracing",
      "LangSmith / OpenTelemetry",
      "LLM-as-a-Judge Pattern",
      "Continuous Evaluation (CI/CD)",
    ],
    date: "September 6, 2026",
  },
  {
    id: 14,
    title: "Multi-Modal Ingestion & Layout-Aware Parsing",
    problem:
      "Standard text extractors read documents blindly from left to right, which destroys multi-column layouts, scrambles financial table rows, and completely ignores embedded visual data like charts and graphs.",
    solution:
      "Upgraded the BullMQ worker to use LlamaParse for layout-aware OCR and Vision AI, returning Markdown for PDFs, Word documents, and supported images. This preserved more layout information than flat extraction. The current October chunker tracks section headings and uses RecursiveCharacterTextSplitter; tables are not guaranteed to remain intact, and repeating column labels in split tables is still pending.",
    terms: [
      "Layout-Aware Parsing",
      "Vision-Language Models (VLMs)",
      "Markdown-Aware Structural Chunking",
      "Multi-Modal Extraction (LlamaParse)",
    ],
    date: "September 6, 2026",
  },
  {
    id: 15,
    title: "Vision AI Failing on Invoices and Charts",
    problem:
      'The default LlamaParse settings crushed borderless invoices into flat paragraphs and returned generic summaries for line charts ("Sales went up") instead of extracting the exact data points. Nested images — a scanned invoice sitting inside a PDF — were skipped altogether due to lazy attention.',
    solution:
      "We injected a universal, structurally focused parsingInstruction. This forces the Vision Model to explicitly convert quantitative charts and borderless layouts into strict Markdown tables, alongside a mandatory override commanding the model to read the text inside embedded scans and exhibits.",
    terms: [
      "Parsing Instruction Steering",
      "Borderless Table Reconstruction",
      "Chart-to-Table Data Extraction",
      "Nested Exhibit OCR",
    ],
    date: "September 6, 2026",
  },
  {
    id: 16,
    title: "Agent Failing to Trigger Autonomous Tools",
    problem:
      'Given a vague prompt like "summary", the LLM acted like a chatbot and asked "Which document?" instead of autonomously firing the get_document_summary tool.',
    solution:
      "We fixed the strict JSON schema requirements for parameter-less functions — explicitly setting required: [] with an aggressive description — and injected a pre-flight system prompt to anchor the agent's context, letting it know a document was already active in the frontend.",
    terms: [
      "Parameter-less Tool Schemas",
      "Tool-Choice Reliability",
      "Pre-flight Context Anchoring",
      "Implicit Intent Resolution",
    ],
    date: "September 6, 2026",
  },
  {
    id: 17,
    title: "Infinite ReAct Loops (Context Overflow & API Drain)",
    problem:
      "When the vector database yielded no relevant results, the LLM assumed its own query was at fault and fired new search queries continuously until it crashed the context window.",
    solution:
      'We implemented a 4-Layer Loop Defense. A hard circuit breaker caps the ReAct while loop at MAX_STEPS = 3. Duplicate detection through a Set() catches and blocks the LLM when it repeats an identical search query. Clear terminal states mean a search returning 0 chunks answers with a strict string (SEARCH_RESULT: Empty…) the model can read as failure rather than as noise. And a prompt bailout rewards the model for admitting "I don’t know" instead of searching forever.',
    terms: [
      "Circuit Breaker (MAX_STEPS)",
      "Duplicate Query Detection",
      "Terminal State Signalling",
      "Graceful Bailout Prompting",
      "Context Window Protection",
    ],
    date: "September 6, 2026",
  },
  {
    id: 18,
    title: "Provider Rate Limits Halted Development",
    problem:
      "Heavy testing exhausted the daily token limits on our primary Groq account, stopping work outright until the quota reset.",
    solution:
      "Because we used standard OpenAI message structures throughout, we built a PROVIDERS configuration dictionary. We can now seamlessly hot-swap the base URL to OpenRouter's free tier — top-tier open-weight models like Llama 3 — without rewriting any ReAct logic or tool schemas.",
    terms: [
      "Provider Abstraction Layer",
      "OpenAI-Compatible Interface",
      "Hot-Swap Failover Configuration",
      "Token Budget Management",
    ],
    date: "September 6, 2026",
  },
  {
    id: 19,
    title: "The Flat Text Ingestion Blindspot (Document Structure Loss)",
    problem:
      "Treating complex PDFs as flat, continuous text blobs destroys page boundaries, flattens dense financial tables, and completely loses embedded visual artifacts like scanned invoices or charts.",
    solution:
      "Implemented a page-aware ingestion pipeline using LlamaParse Vision mode. The document is parsed page-by-page, preserving markdown formatting for tables and scans, while stamping every parent and child chunk with explicit metadata tracking its exact page number and reading sequence.",
    terms: [
      "Page-Aware Ingestion",
      "Vision OCR Parsing",
      "Structural Markdown Retention",
      "Metadata Stamping",
      "Hierarchical Chunking",
    ],
    date: "September 6, 2026",
  },
  {
    id: 20,
    title: "The Vector Search Coordinate Blindspot",
    problem:
      'Semantic vector embeddings match conceptual meaning, not physical coordinates. Asking a RAG agent a location-based question like "What is on page 3?" causes similarity math to fail entirely because the concept of "page 3" has no vector similarity to the actual invoice text.',
    solution:
      "Designed a dual-path agent router. When an explicit coordinate request is detected, the agent bypasses vector distance math completely, executing a lightning-fast indexed JSONB metadata lookup to fetch the exact page content directly.",
    terms: [
      "Dual-Path Agent Router",
      "Deterministic Page Lookup",
      "JSONB Metadata Indexing",
      "Coordinate-Based Retrieval",
      "Semantic vs. Exact Search",
    ],
    date: "September 6, 2026",
  },
  {
    id: 21,
    title: "The Black-Box Answer Problem (Lack of Source Traceability)",
    problem:
      "Enterprise users cannot blindly trust AI-generated answers without verifiable proof of where the information actually originated within large source documents.",
    solution:
      "Engineered a Source Grounding architecture. Retrieved database chunks inject explicit [Source ID: Page X] tags into the LLM context window. Backed by strict system prompt constraints, the model is forced to cite its claims, laying the groundwork for interactive verification chips in the UI.",
    terms: [
      "Source Grounding",
      "Verifiable Citations",
      "Context-Window Injection",
      "Auditable AI Architecture",
      "Inline Citation Tagging",
    ],
    date: "September 6, 2026",
  },
  {
    id: 22,
    title: "Embedding API Costs & On-Device Inference",
    problem:
      "Every ingested document generates hundreds of child chunks, and every user query generates another vector. Routing all of that through a hosted embedding API meant per-chunk network latency, a hard rate-limit ceiling during bulk ingestion, and a recurring cost that scaled linearly with document volume.",
    solution:
      "I moved embedding generation entirely on-device by running Xenova/all-MiniLM-L6-v2 through transformers.js in the Node process itself. The model is loaded once behind a lazily-initialized singleton pipeline and reused across every call, producing 384-dimensional normalized vectors with zero API cost, zero network round-trips, and no rate limit during bulk worker ingestion.",
    terms: [
      "On-Device Inference (transformers.js / ONNX Runtime)",
      "Bi-Encoder Embedding Model",
      "Lazy Singleton Model Caching",
      "Mean Pooling & L2 Normalization",
      "Cost-per-Vector Elimination",
    ],
    date: "September 6, 2026",
  },
  {
    id: 23,
    title: "Ephemeral Filesystem & Stateless Storage Decoupling",
    problem:
      "I initially persisted uploads to a local disk directory via Multer diskStorage. This breaks the moment the app runs on ephemeral or containerized infrastructure — files vanish on redeploy, and a background worker running as a separate process cannot reliably reach another process's local filesystem.",
    solution:
      "I switched Multer to memoryStorage and stream the buffer straight to Supabase Object Storage under a user-scoped path key. The API layer persists only the storage path in Postgres, so the BullMQ worker resolves and downloads the artifact independently. Compute and storage are fully decoupled, and the app is horizontally scalable.",
    terms: [
      "Stateless Application Design",
      "Object Storage Decoupling",
      "Ephemeral Filesystem Problem",
      "Buffer Streaming (memoryStorage)",
      "User-Scoped Storage Keys",
    ],
    date: "September 6, 2026",
  },
  {
    id: 24,
    title: "Blocking Uploads & Asynchronous Job Lifecycle",
    problem:
      "Vision OCR parsing, chunking, and embedding a large PDF takes minutes. Performing that work inside the HTTP request meant the connection would hang until it either finished or hit a gateway timeout, giving the user no feedback and no way to recover.",
    solution:
      "I inverted the contract. The upload endpoint persists metadata, enqueues an extract-and-embed job, and immediately returns 202 Accepted with a document ID. A status column on the Document model tracks the lifecycle from PROCESSING to COMPLETED, letting the frontend poll or subscribe for readiness while the worker processes out-of-band.",
    terms: [
      "202 Accepted / Async Request-Reply Pattern",
      "Job Lifecycle State Tracking",
      "Non-Blocking Ingestion",
      "Gateway Timeout Mitigation",
      "Worker Process Decoupling",
    ],
    date: "September 6, 2026",
  },
  {
    id: 25,
    title: "Opaque Agent Execution & Real-Time Reasoning Transparency",
    problem:
      "An autonomous ReAct agent can take several seconds and multiple tool calls before producing a single token. To the user this is indistinguishable from a hung request, and it hides which retrieval path the agent actually chose.",
    solution:
      "I built a Server-Sent Events channel that streams the agent's internal execution state as it happens. The pipeline emits a discrete event protocol — status while the model reasons, tool_start and tool_finish around each retrieval with the live query and hit count, token for each generated token, and a terminal done — turning an opaque black box into an auditable, real-time execution trace the frontend renders directly.",
    terms: [
      "Server-Sent Events (SSE)",
      "Unidirectional Event Streaming",
      "Structured Event Protocol Design",
      "Token-Level Streaming",
      "Execution Trace Transparency",
    ],
    date: "September 6, 2026",
  },
  {
    id: 26,
    title: "Multi-Tenant Data Isolation",
    problem:
      "A corporate document system is inherently multi-tenant. Without enforced ownership, any authenticated user could retrieve chunks embedded from another user's private documents — a silent data leak through the retrieval layer rather than through an obvious endpoint.",
    solution:
      "I implemented stateless JWT authentication with a middleware that resolves the caller identity onto the request, and scoped ownership through the relational graph. Global cross-document search joins ChildChunk through Document and filters on userId inside the SQL itself, so tenant isolation is enforced at the query level rather than trusted to application logic.",
    terms: [
      "Multi-Tenant Data Isolation",
      "Stateless JWT Authentication",
      "Query-Level Ownership Enforcement",
      "Retrieval-Layer Access Control",
    ],
    date: "September 6, 2026",
  },
  {
    id: 27,
    title: "Database Scale, Indexing & Query Plan Optimization",
    problem:
      "At production scale across hundreds of thousands of chunks, unindexed vector scans and lexical queries force PostgreSQL into full sequential table scans (O(N)), causing severe CPU thrashing, memory bloat, and compounding multi-second latency bottlenecks across parent-child relational joins.",
    solution:
      "I architected a multi-tiered database indexing strategy to transition physical execution paths from O(N) scans to O(log N) traversals. I provisioned Hierarchical Navigable Small World (HNSW) graph indexes on ChildChunk embeddings for fast Approximate Nearest Neighbor (ANN) cosine distance queries, GIN indexes over generated tsvector columns for BM25 keyword matching, and B-Tree indexes across parentId and documentId foreign keys. I verified the access paths using EXPLAIN ANALYZE, confirming zero sequential scans and ensuring sub-50ms hybrid execution under heavy data loads.",
    terms: [
      "Hierarchical Navigable Small World (HNSW)",
      "Approximate Nearest Neighbor (ANN)",
      "Generalized Inverted Index (GIN)",
      "B-Tree Relational Indexing",
      "Query Plan Optimization (EXPLAIN ANALYZE)",
      "Algorithmic Complexity (O(N) to O(log N))",
    ],
    date: "September 23, 2026",
  },
  {
    id: 28,
    title: "Scientific RAG Evaluation Harness & Retrieval Benchmarking",
    problem:
      'Relying on manual, "vibes-based" spot-checking makes it impossible to detect silent retrieval regressions, context starvation, or generation hallucinations when tuning chunk sizes, hybrid search parameters, or system prompts. Without a mathematical baseline, architectural changes cannot be scientifically validated.',
    solution:
      "I engineered an automated, deterministic RAG evaluation harness that decouples and benchmarks retrieval and generation performance independently against a curated Golden Dataset. The pipeline seeds predictable, index-derived chunk IDs that survive database resets, tracking mathematical retrieval metrics (Recall@K, Mean Reciprocal Rank) alongside LLM-as-a-judge generation metrics (Faithfulness to context and Answer Relevance). After validating the harness's sensitivity via intentional query sabotage tests, I used it to benchmark a two-stage retrieval architecture: widening PostgreSQL hybrid retrieval to 15 candidates and applying a Cohere cross-encoder reranker, which empirically proved an MRR leap from 52.5% to 90.0% and achieved 100% Recall@3.",
    terms: [
      "RAG Evaluation Harness",
      "Deterministic Ground Truth Seeding",
      "Mean Reciprocal Rank (MRR)",
      "Recall@K Benchmarking",
      "LLM-as-a-Judge (Faithfulness & Relevance)",
      "Two-Stage Cross-Encoder Reranking",
      "Regression Sabotage Testing",
    ],
    date: "September 23, 2026",
  },
  {
    id: 29,
    title: "Reciprocal Rank Fusion (RRF) Parameter Tuning",
    problem:
      "Standard hybrid search implementations blindly inherit the industry-default RRF smoothing constant (k=60), which heavily biases toward consensus. In a tight top-K retrieval window, this flat decay curve was penalizing highly accurate semantic hits that lacked keyword overlap, capping our baseline MRR.",
    solution:
      "I mathematically tuned the RRF k-parameter by analyzing reciprocal rank decay curves against our evaluation harness. By steepening the decay penalty (lowering k to 10/20), I shifted the algorithm to trust high-confidence single-modality hits over mediocre consensus. This pure mathematical optimization increased our native Recall@5 from 80% to 90% and bumped raw MRR to 56.2% without adding any latency or external dependencies.",
    terms: [
      "Reciprocal Rank Fusion (RRF)",
      "Hyperparameter Tuning",
      "Decay Curve Analysis",
      "Search Consensus vs. Precision",
    ],
    date: "September 23, 2026",
  },
  {
    id: 30,
    title: "Cross-Encoders & Architectural ROI Analysis",
    problem:
      "While tuned hybrid search (Bi-encoder + BM25) cast an excellent net (90% Recall@5), it could not reliably push the target context into the LLM's strict top-3 window (stuck at 50% Recall@3). I needed to determine if the financial cost ($0.002/query) and latency hit (+300ms) of a managed reranker was justified.",
    solution:
      "I ran an architectural ROI analysis using our evaluation harness to contrast our tuned bi-encoder baseline against a Cohere Cross-Encoder. Because a cross-encoder computes deep attention between the query and candidate jointly rather than comparing pre-computed angles, it achieved 100% Recall@3 and a 90.0% MRR. I documented this 37.5% MRR leap to justify the API cost, formally transitioning the system into an enterprise-grade, two-stage retrieval pipeline.",
    terms: [
      "Bi-Encoders vs. Cross-Encoders",
      "Architectural ROI Analysis",
      "Two-Stage Retrieval Pipeline",
      "Latency vs. Precision Trade-offs",
      "Deep Attention Reranking",
    ],
    date: "September 23, 2026",
  },
  {
    id: 31,
    title: "Defensive RAG Guardrails: Dynamic Structural Fencing",
    problem:
      "Standard RAG pipelines are highly vulnerable to Indirect Prompt Injection. If an LLM retrieves a document containing malicious commands (e.g., hidden text attempting to override system prompts), it often executes them because it cannot distinguish between developer instructions and retrieved context.",
    solution:
      "I engineered a dynamic structural fencing mechanism to act as a strict security guardrail, quarantining untrusted retrieval data. By wrapping retrieved chunks in randomized, request-specific XML nonces (e.g., <doc_9a3f81be>), I created a cryptographic boundary in the LLM's attention window. This perfectly preserves legitimate code and math formulas while making it impossible for attackers to forge an exit tag and hijack the generation loop.",
    terms: [
      "Security Guardrails",
      "Indirect Prompt Injection",
      "Structural Fencing",
      "Cryptographic Nonces",
      "Delimiter Hijacking",
    ],
    date: "September 27, 2026",
  },
  {
    id: 32,
    title: "Architectural Guardrails: The Intent Firewall",
    problem:
      "Routing every user interaction to a heavy, multi-step ReAct agent is inefficient and expensive. When malicious users attempted Direct Prompt Injections (jailbreaks), the primary agent wasted valuable API credits, compute, and database resources processing the attack before ultimately refusing it.",
    solution:
      "I implemented a lightweight LLM intent routing layer to serve as a pre-execution guardrail and AI firewall. This middleware evaluates inputs before the ReAct loop initializes, strictly classifying incoming queries as SAFE or MALICIOUS. By short-circuiting jailbreak attempts instantly, this guardrail reduced unnecessary latency, protected backend tools from exploitation, and lowered API overhead for non-compliant requests.",
    terms: [
      "Pre-execution Guardrails",
      "Intent Routing Middleware",
      "Direct Prompt Injection (Jailbreaking)",
      "AI Firewall",
      "Cost/Latency Reduction",
    ],
    date: "September 27, 2026",
  },
  {
    id: 41,
    title: "Compound AI Orchestration: LangGraph & CRAG",
    problem:
      "Native LLM tool calling in a standard ReAct loop is prone to infinite loops, high latency, and hallucinations when dealing with ambiguous queries or failed database searches.",
    solution:
      "I introduced a Corrective RAG (CRAG) pipeline using LangGraph to replace native tool calling with explicit routing, retrieval, grading, rewriting, and generation nodes. The graph bounds retrieval retries and makes failed searches inspectable. It can decompose questions and retry empty evidence searches, but relevance grading does not guarantee complete evidence or eliminate wrong answers.",
    terms: [
      "Compound AI System",
      "LangGraph State Machine",
      "Corrective RAG (CRAG)",
      "LLM-as-a-Judge",
      "Query Decomposition",
    ],
    date: "September 27, 2026",
  },
  {
    id: 42,
    title: "Cost & Latency Optimization: Semantic Routing",
    problem:
      "Routing every user interaction—including simple greetings or summary requests—through a massive 120-billion parameter model for tool selection wasted valuable compute credits and introduced unnecessary latency.",
    solution:
      "I implemented a Semantic Router at the entry point of the graph using a lightweight, high-speed LLM. This node classifies user intent in milliseconds (e.g., greeting, summary, page fetch, complex search) and conditionally routes the payload to specific micro-task nodes, bypassing the heavy ReAct loop entirely for non-search queries and drastically reducing API overhead.",
    terms: [
      "Semantic Routing",
      "Multi-Model Architecture",
      "Latency Optimization",
      "Conditional Edges",
      "Agentic Workflows",
    ],
    date: "September 27, 2026",
  },
  {
    id: 47,
    title: "Multi-Hop Reasoning: Fixing Cross-Page Answers in CRAG",
    problem:
      "Questions whose answer was spread across several pages were refused, answered with outdated values, or answered confidently wrong. Step traces showed that retrieval found the right pages, but the grader judged each chunk in isolation and discarded chunks that were only useful in combination (such as a tariff update that never repeats which slab a usage level falls into). The generator also refused partial answers, and a single search for long questions missed smaller sub-facts.",
    solution:
      "I changed grading to one call over the combined retrieved evidence, allowing partial evidence, calculation inputs, and corrections to be considered together. I added generation instructions for dates, grounded arithmetic, and explicit partial answers, plus question decomposition and parent deduplication. Rewriting changes the search query while preserving the original question. These changes improved tested examples; later stress tests still exposed missing table labels and wrong-column answers. Decomposition currently creates independent searches, so dependent multi-hop retrieval remains unfinished.",
    terms: [
      "Multi-Hop RAG",
      "Query Decomposition",
      "Context-Aware Relevance Grading",
      "Temporal Grounding",
      "Model Tiering",
    ],
    date: "September 27, 2026",
  },
  {
    id: 48,
    title: "Summary Readiness and Task-Based AI Routing",
    problem:
      "Users had to wait for the summary before asking questions, even when chunks were ready. One provider setting also prevented summaries and fast tasks from using different services.",
    solution:
      "Separated ingestion status from summaryStatus so questions become available as soon as chunks are saved. Summaries have their own readiness checks, and summary failure leaves document search available. Added task-based provider routing: mixed mode defaults summaries to OpenRouter and other LLM roles to Groq; a named global provider overrides all LLM tasks. Applied the schema migrations and regenerated Prisma Client during the approved development reset.",
    terms: [
      "Independent Summary Readiness",
      "Early Question Availability",
      "Task-Based Provider Routing",
      "Schema Migration",
    ],
    date: "October 3, 2026",
  },
  {
    id: 49,
    title: "Section-Aware Chunking, Contextual Search, and Inspection",
    problem:
      "Page breaks separated passages from their headings and document context. Bare chunks and limited inspection made missing context difficult to diagnose.",
    solution:
      "Added persistent section breadcrumbs, separate raw text and contextual searchText, page metadata, and same-section parent links. Embeddings, hybrid search, reranking, grading, and generation now use contextual text; retrieval adds immediate neighboring parents. Added embedding token checks, authenticated chunk inspection, detailed live events, console logs, and frontend payload documentation. Saved chunks can be inspected after refresh; Redis event history is now disabled. Stress tests still found incorrect heading relationships, interrupted tables assigned to the wrong section, and rows separated from column labels. Heading validation, table continuation detection, repeated headers, and explicit section references remain pending.",
    terms: [
      "Section Breadcrumbs",
      "Contextual Parent-Child Chunks",
      "Neighbor Expansion",
      "Chunk Inspection",
      "Embedding Token Checks",
    ],
    date: "October 4, 2026",
  },
  {
    id: 50,
    title: "Table of Contents (TOC) Hijacking & Search Pollution",
    problem:
      "The Table of Contents (TOC) at the start of documents was getting chunked like regular content. Because it contains chapter names and numbers, our chunker got tricked into thinking every TOC row was a real section header. This scrambled the whole outline—real sections got trapped under TOC headers, and user searches kept returning useless TOC page lists instead of real text.",
    solution:
      "We added a check to detect Table of Contents pages and tagged those chunks with an 'is_toc' flag. We filtered them completely out of database searches so they never show up in answers, and we stopped the chunker from using TOC lines to build the document's heading tree.",
    terms: [
      "Table of Contents Filter",
      "Heading Hierarchy Guard",
      "Search Noise Elimination",
      "Breadcrumb Protection",
      "Metadata Tagging",
    ],
    date: "October 10, 2026",
  },
  {
    id: 51,
    title: "Heading Leakage Across Standalone Forms & Attachments",
    problem:
      "When reports had standalone forms, factory test records, or appendices at the very end, our chunker blindly attached the previous chapter's heading to them. For example, a quality control test sheet on page 24 was falsely labeled as part of 'Section 2 Corporate Structure', creating confusing metadata and wrong reading order links.",
    solution:
      "We added document boundary detection. Whenever the system spots a clean break like a test certificate, form number, letterhead, or appendix (like 'Form FAT-07' or 'Appendix E'), it clears out the old chapter breadcrumbs and starts fresh with the attachment's own title. This stops earlier headings from leaking into separate documents.",
    terms: [
      "Document Boundary Detection",
      "Heading Stack Reset",
      "Form & Certificate Isolation",
      "Context Leakage Prevention",
      "Clean Attachment Breadcrumbs",
    ],
    date: "October 10, 2026",
  },
  {
    id: 52,
    title: "Batch Extraction Markdown Validation Crash",
    problem:
      "While uploading larger PDF files, the document background worker suddenly crashed with an error saying 'Document extraction returned invalid Markdown for batch 1'. The code was checking for a plain string in a way that failed when the batch extractor returned structured page objects, bringing the whole upload to a halt.",
    solution:
      "We fixed the batch extraction unpacking logic in ai.service.js to correctly pull out the markdown text for each page ID. This eliminated the false-alarm validation errors and made multi-page document ingestion reliable.",
    terms: [
      "Batch Extraction Resilience",
      "Worker Error Handling",
      "Markdown Validation",
      "Page Unpacking",
      "Ingestion Stability",
    ],
    date: "October 11, 2026",
  },
  {
    id: 53,
    title: "Multi-Hop Cross-References & Precedence Overrides",
    problem:
      "In technical and financial reports, critical answers are often scattered across different pages. One page says 'we fit 4 units in a container, see Table 4.2 for capacity', or a draft financial figure is later overridden by a 'Board Resolution' or 'Restatement Note' in the appendix. Standard vector search only found one half of the answer or gave an outdated draft number because it had no idea the appendix existed.",
    solution:
      "We taught the extractor to identify explicit cross-references (like §4.3, Table 4.2, Resolution 2025-14, TN-6) and automatically follow them during retrieval to pull in the companion chunks. We also gave the answer generator strict precedence rules so that final board resolutions and restatements always override older draft numbers.",
    terms: [
      "Cross-Reference Following",
      "Multi-Hop Evidence Gathering",
      "Precedence & Restatements",
      "Board Resolution Overrides",
      "Linked Information Retrieval",
    ],
    date: "October 11, 2026",
  },
  {
    id: 54,
    title: "Progressive Query Rewriting with Discovered Facts in CRAG",
    problem:
      "When an answer required multiple steps—like first finding a secret project code or customer name, and then finding that customer's test results—our CRAG query rewriter got stuck. Because it did not know what clues round 1 had already uncovered, it just kept rewording the original question in circles without making progress.",
    solution:
      "We connected the relevance grader and query rewriter so that any facts, names, or codes found in earlier search rounds are passed forward. The rewriter now takes the newly discovered clue and uses it to craft the next specific search query, successfully completing multi-step investigations.",
    terms: [
      "Stateful Query Rewriting",
      "Fact Accumulation",
      "Multi-Step Search Planning",
      "Corrective RAG",
      "Iterative Follow-Up Queries",
    ],
    date: "October 11, 2026",
  },
  {
    id: 55,
    title: "Context Token Explosion & Groq TPM Rate Limit (413 Error)",
    problem:
      "Because parent chunks are large (around 1,024 tokens each), blindly fetching every cross-reference, table continuation, and neighboring chunk caused retrieval to pull in 18+ chunks at once. This created a massive 9,361-token prompt that crashed into Groq's 8,000 Tokens Per Minute (TPM) limit on 120b models with an HTTP 413 error.",
    solution:
      "Identified the need for token budgeting and smart gating: restricting reference following to primary search seeds, ignoring non-essential diagram/figure links, and applying a hard context ceiling (capping context to ~4,000 tokens / 6 chunks) so the final prompt never overflows the LLM's rate limit.",
    terms: [
      "Token Budgeting",
      "TPM Rate Limit Protection",
      "Prompt Ceiling",
      "Throttled Neighbor Expansion",
      "Groq LPU Optimization",
    ],
    date: "October 11, 2026",
  },
  {
    id: 56,
    title: "Reference-Following Table of Contents (TOC) Hijack",
    problem:
      "While SQL hybrid searches filtered out Table of Contents chunks using the 'is_toc' metadata flag, our dynamic reference-following query in the repository fetched candidate matches using standard text containment without checking for TOC pages. When following an override citation such as 'see Appendix B', the Table of Contents—which naturally lists 'Appendix B' at the beginning of a line—scored highest in candidate ranking and was mistakenly pulled into LLM context instead of the actual substantive document.",
    solution:
      "We filtered out 'is_toc' chunks directly within the reference candidate evaluator in chat.repository.js. Reference resolution now bypasses index and table of contents pages completely, ensuring that followed citations only pull substantive definitions and body sections.",
    terms: [
      "Reference Resolution Guard",
      "TOC Candidate Pruning",
      "Neighbor Expansion Filtering",
      "Substantive Chunk Isolation",
      "Override Routing Accuracy",
    ],
    date: "October 11, 2026",
  },
  {
    id: 57,
    title: "Subheading Hierarchy Collapse & Local Reference Bleed",
    problem:
      "In documents with unnumbered subheadings (such as 'Certifications' or technical notes 'TN-1' through 'TN-8'), our heading detector assigned them a shallow fallback depth of 2. This mistakenly popped major chapter headers (e.g. popping Section 4 'Products and Technology'), breaking the heading breadcrumb tree. Simultaneously, AI-extracted cross-references were being attached at the page level, causing isolated sub-chunks to inherit references belonging to other sections on the same page.",
    solution:
      "We clamped unnumbered heading depths to a minimum level of 3 to preserve existing chapter hierarchy without popping parent sections. In addition, we added text verification to the chunker so chunks only retain cross-references that are explicitly mentioned within their own text passage, stopping cross-reference bleed across chunk boundaries.",
    terms: [
      "Heading Depth Clamping",
      "Hierarchy Collapse Prevention",
      "Cross-Reference Verification",
      "Passage-Level Isolation",
      "Breadcrumb Stack Integrity",
    ],
    date: "October 11, 2026",
  },
  {
    id: 58,
    title: "Trace Step Persistence & Historical Reasoning Observability",
    problem:
      "While live SSE events streamed execution traces (intent classification, query planning, rerank scores, and candidate grading) to the user during active generation, these multi-step traces were purely ephemeral. Upon browser refresh or when reviewing past chat sessions, users could only view the final raw text, losing all visibility into how the agent retrieved and reasoned through evidence.",
    solution:
      "We updated the chat generation workflow to accumulate non-token execution events into a structured trace array and persist them directly inside PostgreSQL under Message.metadata.steps. This gives the frontend full historical access to multi-hop reasoning steps, tool calls, and retrieval metrics on reload.",
    terms: [
      "Execution Trace Persistence",
      "Audit Trail Storage",
      "Historical Observability",
      "Agent Reasoning Replay",
      "PostgreSQL Metadata Storage",
    ],
    date: "October 11, 2026",
  },
  {
    id: 59,
    title: "Hybrid Search Tiers & Search Provenance",
    problem:
      "Keyword search turned every word of the question into a search term, including vague words like 'that' or 'new', so common words outranked what mattered. Exact identifiers such as 'PBLU-4471902' or 'R-07' were split into pieces by the PostgreSQL text parser, and multi-word names like 'New Zealand' were matched as unrelated single words. After an agent model switch, the planner also copied the raw user question into search. On top of that, the trace could not show which search found a chunk or how the reranker moved it, candidates arrived unsorted, and BigInt counts crashed trace serialization.",
    solution:
      "The planner now returns structured queries { text, keywords, identifiers, entities }, and buildSearchTiers() turns them into four searches: identifiers through ILIKE (weight 2.5), entities as adjacent-word phrases (1.5), planner-chosen keywords joined with OR (1.0), and vector search on the query text (1.0), merged with weighted Reciprocal Rank Fusion (k=10). websearch_to_tsquery was considered but not used, because it joins plain words with AND and splits identifiers. Each tier sorts before its LIMIT, the final result is ordered by total score, and an empty keyword query no longer crashes. Each candidate carries matchedBy, per-tier ranks, retrievalRank, rerankRank and rerankApplied for the frontend trace.",
    terms: [
      "Tiered Hybrid Search",
      "Weighted Reciprocal Rank Fusion",
      "Structured Query Planning",
      "Exact Identifier Matching",
      "Retrieval Provenance",
    ],
    date: "November 4, 2026",
  },
  {
    id: 60,
    title: "Chat History: Duplicate Questions & Truncated Answers",
    problem:
      "The user's message was saved before history was loaded, so the planner and answer step received the current question twice. Every assistant answer in history was also cut to 200 characters. For the follow-up 'What is the group ownership of the last two?', the planner saw only the first row of the previous subsidiaries table, so it either planned a three-step chain to rebuild the list or guessed the wrong subsidiary.",
    solution:
      "History is now loaded before the question is saved. The last two question/answer pairs are kept in full (up to 3,000 characters each), and older messages are cut to 200 characters. Summarizing older history and semantic history retrieval were considered and postponed, because document follow-ups mostly refer to the latest answer. The same follow-up now plans the correct two subsidiaries by name and finishes in one round.",
    terms: [
      "Conversation Memory",
      "Sliding Window Memory",
      "History Token Budget",
      "Coreference Resolution",
    ],
    date: "November 7, 2026",
  },
  {
    id: 61,
    title: "Relevance Grader: Discarded Evidence & Missed Amendments",
    problem:
      "The 20B grader often found the right answer but filled its JSON badly: an empty value on a list task, empty inputBindings on dependent tasks, and quotes that dropped or reworded lines. Validation rejected the whole task, the rejection cascaded to every dependent task, and correct rounds were thrown away; one follow-up used three rounds and over two minutes for an answer found in round one. The grader also kept only the chunk that resolved a task, so a later board resolution raising Vantara Gulf FZE's ownership from 74% to 90% was mentioned only by luck.",
    solution:
      "The grader moved from the fast 20B model to the larger agent model, which filled values and bindings correctly in testing; inputBindings validation was kept on purpose. Quote checking now accepts a quote when at least 80% of its lines or '...' pieces appear in the chunk in order, instead of requiring one exact copy. A new rule keeps chunks that change, amend or supersede a fact the question asks about, without changing the task's value, so the answer step can explain both the baseline and the change. The follow-up now finishes in one round and mentions the pending 90% resolution.",
    terms: [
      "Evidence Verification",
      "Validation Cascade",
      "Fuzzy Quote Matching",
      "Amendment Awareness",
      "Model Capacity for Structured Output",
    ],
    date: "November 7, 2026",
  },
  {
    id: 62,
    title: "Query Rewriter Answering Instead of Searching",
    problem:
      "The rewriter received candidate passages that already contained the answer, and the small model replied with a markdown table answer instead of a search phrase. Code only checked that the reply was at least 4 characters and not repeated, so the table became the next search query. Keyword search filled with junk terms, and the reranker scored almost every chunk near 1.0 because the query contained the answer itself.",
    solution:
      "cleanSearchQuery() accepts only a single line of at most 150 characters and 20 words with no table syntax, for both the rewriter and the grader's next_query. A rejected reply stops the loop with an 'invalid_query' reason and is kept as rawQuery in the trace. The rewriter prompt also says never to answer the question.",
    terms: [
      "LLM Output Validation",
      "Query Sanitization",
      "Instruction Drift",
      "Guarded Query Rewriting",
    ],
    date: "November 7, 2026",
  },
  {
    id: 63,
    title: "Follow-up Searches Lost Exact-Match Tiers",
    problem:
      "Only the first round used the structured query { text, keywords, identifiers, entities }. The grader's next_query and the query rewriter returned plain sentences, so every follow-up round ran only vector and keyword search. A chain like 'project -> risk R-04 -> owner' found the risk code in round one, but round two could not search for 'R-04' as an exact identifier, and the owner's row was missed or ranked low.",
    solution:
      "The grader's next_query and the rewriter now return the same search object as the planner, validated by toSearchQuery() and stored as nextQuery in the graph state, so identifier and phrase search run in every round. One shared set of search-object rules (with generic examples only) is used by the grader and the rewriter, and it forbids copying codes or names from tasks that are already resolved. On the test question, round two ran the identifier tier for R-04 and every fact in the three-step chain was found on purpose.",
    terms: [
      "Structured Follow-up Queries",
      "Multi-Round Retrieval",
      "Exact Identifier Matching",
      "Shared Output Schema",
    ],
    date: "November 7, 2026",
  },
  {
    id: 64,
    title: "Dependent Questions Planned as One Lookup",
    problem:
      "Questions such as 'Who owns the risk linked to the expansion project?' need several facts that live in different tables: the project's risk, the risk's owner role, then the person holding that role. The planner often wrote one task for the whole chain, so the grader marked it resolved as soon as one passage looked close, and a role title was returned where a name was asked for.",
    solution:
      "Planner rule 'one hop = one lookup' splits the question at every relationship ('linked to', 'owned by', 'reports to', 'approved by') into its own task with dependsOn, and gives starting queries only for the first task. Its worked example (ticket -> team -> manager -> email) is deliberately unrelated to any test document. Verified on two synthetic reports: a three-step risk-owner chain and three chain questions on a second report all answered correctly.",
    terms: [
      "Query Decomposition",
      "Multi-Hop Planning",
      "Dependency Graph",
      "Entity Resolution",
    ],
    date: "November 7, 2026",
  },
  {
    id: 65,
    title: "Planner Over-Planning & Slow Planning",
    problem:
      "After the one-hop rule, the planner added optional 'find the name, if needed' tasks even when the previous task already returned a name, and spent 2,600-5,600 hidden reasoning tokens (27-55 seconds) deciding them. Questions like 'Which body had to approve the budget increase?' were planned as a direct lookup, so the answer came from the meeting minutes (who did approve) and the approval-threshold table that states who must approve arrived only by luck as a neighboring chunk.",
    solution:
      "The rule now asks for the person's name inside the task that finds the person ('the owner, the person's name, not only the role') and forbids optional tasks. A new rule says 'had to / must approve' questions need the case's deciding value and the rule table, then a task that applies one to the other. On the test chain question the plan dropped from five tasks to four and planning from 5,606 to 1,095 tokens with the same correct answer. The approval rule is not yet verified: the model ignored its first wording.",
    terms: [
      "Prompt Ambiguity",
      "Reasoning Token Budget",
      "Rule-Based Question Planning",
      "Planner Latency",
    ],
    date: "November 8, 2026",
  },
  {
    id: 66,
    title: "Single-Owner Documents to Role-Based Access",
    problem:
      "Every document belonged to the user who uploaded it, and access was checked separately in about ten places. There was no way to give a team a set of documents. Several gaps showed up during the redesign: the document list endpoint returned every document with its summary to any logged-in user, the chat accepted any conversation ID without checking its owner, global search kept only the newest document per filename (which would hide another user's file with the same name), a disabled account kept working until its 7-day token expired, and each user had only one global chat.",
    solution:
      "Admins upload documents into one library, create roles (a name plus documents) and users (with one or more roles), and only role links decide access: no copied user-document table to keep in sync. One access service answers 'which documents can this user see' (admin: all; user: documents of all their roles), and every list, inspector, document chat and search uses it, answering 404 rather than 403 so hidden documents are not revealed. Chat computes allowedDocumentIds once per question and passes it through the graph state into the search SQL, where every tier joins only those documents, and into neighbor expansion. The auth middleware loads the user on every request (disabled users are out immediately, temporary passwords must be changed first), and users get many global chats titled from their first question. One lesson: passing a user ID instead of the user object made the role filter undefined, which Prisma silently ignores, and briefly showed documents from other roles.",
    terms: [
      "Role-Based Access Control (RBAC)",
      "Many-to-Many Join Tables",
      "Query-Time Access Filtering",
      "Least Privilege",
      "Session Revalidation",
    ],
    date: "November 9, 2026",
  },
  {
    id: 67,
    title: "Account Onboarding by Email",
    problem:
      "With public sign-up removed, the admin had to pass each new user's temporary password by hand. The forgot-password endpoint returned the reset code in its API response because there was no email, so anyone who knew an address could reset that account, including the admin's.",
    solution:
      "An SMTP mail service sends new users the platform link, their email and the temporary password, sends a new temporary password when the admin resets one, and sends forgot-password codes. Sending never throws: a mail failure does not undo the user change, and the response says emailSent true or false so the admin can share the details manually. Removing the code from the forgot-password response is the remaining step.",
    terms: [
      "Transactional Email",
      "Credential Delivery",
      "Graceful Degradation",
      "Account Recovery",
    ],
    date: "November 9, 2026",
  },
  {
    id: 68,
    title: "Rule Questions Answered from Past Events",
    problem:
      "On a 50-document knowledge base for one company, questions such as 'Who must approve a USD 30,000 hardware order raised on 5 November?' or 'Who must claim the service credit, and by when?' were answered from what happened, not from the rule. The planner searched for the stated order as if it existed, wrote the rule search in the case's words (hardware, the date) so it found the purchase log instead of the approval table, stopped at a role where a name was asked, returned the date a claim was made where the deadline was asked, and gave one of two starting tasks no search at all. When the grader did find names, the answer step sometimes left them out.",
    solution:
      "Planner rules and, above all, examples: a value the user states is a given; a rule check needs a rule task, a facts task and a compare task, each naming the kind of value; a rule found in a table is followed by a task for the person who held the role on the case's date; rule tasks use the rule document's words ('purchase approval limits by value'). A sentence alone was ignored; changing the examples worked. Each starting query names its task, and code adds a search for any starting task without one. The grader checks the kind of value (a deadline is not an event date, a role is not a person), and the answer step receives a code-built list of verified facts with the end of each chain marked final. The approval question went from wrong to correct with every fact found on purpose.",
    terms: [
      "Query Decomposition",
      "Few-Shot Prompting",
      "Rule vs Event Retrieval",
      "Answer Grounding",
    ],
    date: "November 13, 2026",
  },
  {
    id: 69,
    title: "Correct Evidence Thrown Away by Strict Checks",
    problem:
      "The grader often found the right passage, and code rejected it. One cited ID was a document ID instead of a chunk ID, which rejected the whole task; honest quotes from tables failed the exact-match check because the grader joined table lines or skipped an older-version line; and a task needing two people could never resolve when they were found in different rounds, because the grader saw only the new round's chunks plus evidence of tasks already resolved. The search then stopped for lack of progress and the answer guessed.",
    solution:
      "A quote naming an unknown chunk is dropped while the task keeps its valid quotes; the grader no longer sees document IDs. The quote check also accepts a quote whose words all appear in the passage in the same order within a short span, ignoring Markdown, while a changed number, a changed name or scattered words still fail; the grader prompt asks for whole lines copied in order. The grader now sees every chunk kept in earlier rounds, so facts found in different rounds resolve together.",
    terms: [
      "Evidence Verification",
      "Fuzzy Quote Matching",
      "Hallucinated References",
      "Cross-Round Evidence",
    ],
    date: "November 13, 2026",
  },
  {
    id: 70,
    title: "Runaway Model Reasoning in Planning and Grading",
    problem:
      "The same planning or grading request took 15 seconds one time and 90 seconds to over 3 minutes another, because the model sometimes reasoned for 8,000 hidden tokens. Some calls hit the provider's output limit and returned nothing, losing a whole search round, and those failed calls were billed but never shown in the cost.",
    solution:
      "Planner and grader calls now ask for low reasoning effort and set their own output limit; the planner call also has a 90-second timeout with no silent client retries, so a stuck attempt fails fast and the second attempt runs. Planning dropped to 6-29 seconds. Failed calls now record their cost. Low effort reduces reasoning on average but is not a hard cap, so a retry on a cut-off grader reply is the next step.",
    terms: [
      "Reasoning Effort",
      "Output Token Budget",
      "Request Timeouts",
      "Cost Observability",
    ],
    date: "November 13, 2026",
  },
];

export default PIPELINE;
