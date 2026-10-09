# ISGEC Questionnaire

Each question separates the current implementation from a suggested client response. Proposed work is subject to agreed scope and pilot validation.

**Part 1: Infrastructure**

**Q1. Sizing, concurrency, latency and document volume**

**Built so far:** API-based inference and queued document ingestion. No validated sizing or latency results for 25–40 concurrent users or a self-hosted 32B–70B model; no production document volume is defined.

**Suggested answer to client:** We propose sizing the deployment through a POC using representative ISGEC documents, agreed corpus volume and 25–40 concurrent users. Hardware and latency commitments will follow load testing.

**Q2. HA, DR, backups and RPO/RTO**

**Built so far:** PostgreSQL, Supabase document storage and Redis queues are integrated. Production HA/DR, backup policies and recovery targets are not defined or validated.

**Suggested answer to client:** We propose defining HA/DR, database and document backups, retention and restore procedures during deployment planning. RPO/RTO targets will be agreed with ISGEC IT and validated through recovery testing.

**Part 2: Model and Search**

**Q1. Models, licences and GPU needs**

**Built so far:** The configured defaults include:

- **LLM:** [GPT-OSS-120B](https://developers.openai.com/api/docs/models/gpt-oss-120b) and [GPT-OSS-20B](https://developers.openai.com/api/docs/models/gpt-oss-20b), Apache 2.0, accessed through hosted APIs.
- **Embedding:** [all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2), Apache 2.0, running locally on CPU.
- **Reranker:** Cohere `rerank-english-v3.0`, hosted under [Cohere service terms](https://cohere.com/terms-of-use).
- **OCR/VLM:** Gemini-based extraction, hosted under [Google API terms](https://ai.google.dev/gemini-api/terms).

**Suggested answer to client:** This stack provides the POC baseline without local inference GPUs. Final models and API terms will be reviewed against ISGEC quality and data-handling requirements; on-premises inference needs separate model selection and GPU sizing.

**Q2. Serving engine and model swapping**

**Built so far:** The backend consumes hosted OpenAI-compatible Chat Completions APIs with configurable providers and models. No self-hosted serving engine is deployed.

**Suggested answer to client:** The LLM integration supports model changes through compatible provider configuration and validation. For on-premises deployment, we propose an OpenAI-compatible serving engine selected during the POC.

**Q3. Vector database and department access**

**Built so far:** PostgreSQL with pgvector and full-text search. User ownership is checked before document search; department permissions are not implemented.

**Suggested answer to client:** We propose PostgreSQL/pgvector for hybrid retrieval, extended with department and role permissions enforced before both vector and keyword search. Current access isolation is per user.

**Q4. Drawings, P&IDs, scans and DWG**

**Built so far:** PDFs and supported images undergo visual extraction, including scanned pages. Engineering drawing/P&ID interpretation is not validated; native DWG ingestion is unsupported.

**Suggested answer to client:** Scans and PDF/image drawings can be assessed in the pilot. P&ID symbols, tags and connectivity need dedicated accuracy testing; DWG files require conversion to supported formats or a scoped CAD integration.

**Q5. Pilot acceptance criteria**

**Built so far:** Evaluation scripts cover retrieval recall/MRR, answer relevance and faithfulness. Extraction accuracy, citation correctness and latency need dedicated measurement; acceptance thresholds are not agreed.

**Suggested answer to client:** We propose an ISGEC-approved test set measuring extraction accuracy, retrieval relevance, citation correctness and latency under 25–40 concurrent users. Pass thresholds will be agreed before testing and reported with measured results.

**Part 3: Security**

**Q1. SSO and MFA**

**Built so far:** Password authentication and JWT sessions. AD/Entra ID SSO and MFA are not implemented.

**Suggested answer to client:** We propose integrating ISGEC's identity provider for SSO and enforcing MFA through its identity policies. This integration requires additional implementation and testing.

**Q2. Injection controls, keys, audit retention and SIEM**

**Built so far:** LLM-based injection screening and defensive answer prompts are implemented; screening can allow input if its result cannot be parsed. Keys use environment variables. Central secret management, formal audit retention and SIEM integration are not implemented.

**Suggested answer to client:** Initial prompt-injection controls are present. For production, we propose security testing, stricter screening failure handling, managed secrets and key rotation, and audit logs with ISGEC-approved retention and SIEM forwarding.

**Q3. VAPT and certifications**

**Built so far:** No VAPT report or ISO 27001 certification evidence is available in the project.

**Suggested answer to client:** We propose VAPT and remediation before production release. Any certification claims must be supported by valid certificates covering the relevant vendor or hosting scope.

**Part 4: Future Use and Ownership**

**Q1. Shared internal API and multi-tenancy**

**Built so far:** Authenticated document and chat APIs exist. Standalone shared LLM/retrieval endpoints and company-level multi-tenancy are not implemented; current isolation is per user.

**Suggested answer to client:** The backend can be extended into a shared internal service for ISGEC applications and group companies. We propose tenant isolation, role permissions and scoped API access as additional work.

**Q2. Ownership, handover and knowledge-base export**

**Built so far:** Source code, prompts, schemas, evaluation datasets and pipeline code exist in the repository. Knowledge-base data is stored in PostgreSQL and Supabase Storage; a packaged export feature is not implemented.

**Suggested answer to client:** We propose handing over project code, prompts, schemas, agreed evaluation sets, pipeline documentation and data export procedures. Ownership and third-party exclusions must be agreed contractually; knowledge-base export requires additional tooling.

**Q3. Fine-tuning, costs and Phase 2**

**Built so far:** A RAG pipeline is implemented; fine-tuning is not. GPT-OSS supports fine-tuning, but no training pipeline, budget or Phase 2 scope is established.

**Suggested answer to client:** We propose improving retrieval and evaluating the pilot before deciding on fine-tuning. Phase 2 may cover SSO/MFA, department permissions, multi-tenancy, drawing support and production operations. Costs depend on agreed scope, training data, compute and validation.
