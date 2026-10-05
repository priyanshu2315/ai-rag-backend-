/**
 * The engineering timeline behind DocuMind, reviewed 5 October 2026.
 * Earlier entries describe historical stages, not guarantees about the current
 * implementation. The October entries record current behavior and open gaps.
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
];

export default PIPELINE;
