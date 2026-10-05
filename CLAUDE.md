@AGENTS.md

# Session handoff — reviewed 5 October 2026

Read the shared instructions imported above before acting. They contain the current architecture, approval rule, recent migration history, inspection APIs, and confirmed failures. A request to inspect or explain authorizes reading only; edit files only when the user explicitly requests the change.

Recent work added task-based provider routing, separate chunk/summary readiness, section context in parent/child `searchText`, same-section parent links and search expansion, inspection responses, detailed live events/logs, and embedding token checks. The development reset/migrations were approved and applied on 4 October; that does not authorize another reset.

Current code disables Redis progress history to save storage. Saved chunks remain inspectable after refresh, but original extracted pages and upload event history are not replayed. The older replay description in `docs/frontend-chunk-inspector.md` must be checked against `src/config/uploadProgress.js`.

The stress test still exposes heading hierarchy errors, interrupted tables assigned to the wrong section, missing links from section 5A to section 5, and table rows separated from column labels. Kettleby's correct city-proper population for 31 December 2023 is 163,482; 158,744 is the earlier census. These defects were diagnosed, not fixed. Keep document identity generic; do not require company names from users.

Use `docs/architecture.html` for the current visual map and `docs/pipeline.js` for the development timeline. Earlier timeline entries describe historical stages; the October entries explain the present behavior and remaining work. Verify runtime details against source code.
