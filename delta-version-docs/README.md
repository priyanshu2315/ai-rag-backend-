# Delta version test documents

One small made-up policy, "Equipment Purchase Policy" (Harlow Fabrication Ltd, 2 pages), in 3 versions. Used to test replace (`PUT /api/documents/:docId`, ROADMAP Step 3). `source/` holds the HTML each PDF was printed from (Chrome, A4).

| File | Pages | What changed |
|---|---|---|
| `Equipment-Purchase-Policy_v1.pdf` | 2 | the original |
| `Equipment-Purchase-Policy_v2.pdf` | 2 | from v1: approval limit 50,000 -> 40,000 (Table 1, 2 rows); records kept six -> eight years; version and date on the cover. Nothing moves to another page. |
| `Equipment-Purchase-Policy_v3.pdf` | 2 | from v2: new paragraph about leased equipment in section 1 (page 1; it pushes the last sentence of section 3 onto page 2); heading "5. Emergency purchases" renamed "5. Urgent repairs"; deadline two working days -> one working day; the sanctions sentence in section 6 removed; version and date on the cover. |

## Test steps and expected results

| Step | Request | Expected response |
|---|---|---|
| 1 | `POST /api/documents/upload` with v1 | `202`; wait until processing finishes |
| 2 | `PUT /api/documents/<id>` with v1 again | `200`, `reason: "same_file"` |
| 3 | `PUT` with v2 | `202`, `diff: { kept: 43, added: 5, removed: 5, moved: 0 }` |
| 4 | `PUT` with v3 | `202`, `diff: { kept: 43, added: 6, removed: 5, moved: 0 }` |

These `diff` numbers were checked on 19 November with `document-units.service.js`. They count PDF lines and sentences, not chunks.

Expected chunk changes (the AI rewrites a section slightly differently on each run, so 1-2 extra chunks may change):
- v1 -> v2: cover (version, date), section 3 (table) and section 7 change; sections 1, 2, 4, 5, 6, 8 are kept with the same IDs.
- v2 -> v3: cover, section 1 (new paragraph), section 5 (heading and deadline) and section 6 (sentence removed) change. Section 3 now runs across the page break but its text is the same, so it is kept (only its page list changes). Sections 2, 4, 7, 8 are kept.

## Questions to ask after each step

| After | Question | Expected answer | Where |
|---|---|---|---|
| v1 | Who must approve an equipment order of GBP 45,000? | Head of Finance (band 5,001 to 50,000) | v1 page 1, section 3, Table 1 |
| v2 | Who must approve an equipment order of GBP 45,000? | Managing Director (band above 40,000); must not say Head of Finance | v2 page 1, section 3, Table 1 |
| v2 | How long must purchase records be kept? | Eight years after the order is closed | v2 page 2, section 7 |
| v3 | Within how long must the site manager inform the Head of Finance after an urgent repair? | One working day | v3 page 2, section 5 "Urgent repairs" |
| v3 | Is leased equipment covered by the policy? | Yes; a lease longer than twelve months is approved as if the full lease amount were one purchase order | v3 page 1, section 1 |
| v3 | Are new suppliers screened against the sanctions list? | The policy no longer says so (the sentence was removed in v3); must not answer "yes" | v3 page 2, section 6 |
