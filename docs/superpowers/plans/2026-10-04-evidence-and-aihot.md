# Evidence and AIHOT Implementation Plan

> **For agentic workers:** Implementation is requested. Execute task by task with the current tools and permissions. Checkboxes track verified work.

**Goal:** Make local evidence status honest, import AIHOT with recoverable cursors, preserve revisions and human review, and generate traceable reports before pushing the current branch.

**Architecture:** Keep Next.js and SQLite. Add additive migrations, a shared evidence projection, a bounded page-at-a-time AIHOT sync service, and structured report citations. Preserve the existing Gemini collector as a supplementary source.

**Tech Stack:** TypeScript, Next.js, better-sqlite3, Node test runner.

## Scope and Safety

- User approved regression boundaries: signal listing, import/sync, human confirmation, report output. Tests use temporary databases and mocked external HTTP responses.
- Retain existing `next-env.d.ts` changes and do not commit them. Never commit SQLite, credentials, private notes, or test artifacts.
- No automatic paid model calls during verification. Live API smoke checks are bounded and use a temporary database.
- Deliver the evidence/input/report foundation now. Long-horizon event inference, independent Gemini workers and paid-call recovery require a subsequent migration; do not present them as completed.

## Task 1: Evidence and Review

Files: `lib/evidence.ts`, `lib/sourceUrls.ts`, `lib/classifier.ts`, `lib/collector.ts`, `lib/db.ts`, `lib/types.ts`, `db/migrations/003_evidence_and_sync.sql`, `app/api/signals/[id]/route.ts`, `tests/workflow.test.mjs`, `tests/tsconfig.json`.

- [x] Add a regression through insertion and listing:

```js
await insertSignal(classifySearchResult({title: 'Unknown date', url: 'https://www.google.com/search?q=fixture', snippet: 'fixture', sourceName: 'Search', sourceDomain: 'google.com', discoveredBy: 'test'}));
const [signal] = await listSignals({query: 'Unknown date'});
assert.equal(signal.date, '');
assert.equal(signal.evidence.sourceStatus, 'search');
assert.equal(signal.evidence.reviewStatus, 'unreviewed');
```

- [x] Run `npm test` and observe the regression failing before changing behavior.
- [x] Reject search/redirect URLs as direct sources; invalid dates remain unknown. Keep discovery dates separate. Add human review status, revision binding, notes and optimistic version checks.
- [x] Verify review survives a reload, stale edits fail, and missing direct sources cannot become confirmed evidence.

## Task 2: AIHOT Sync and Material Versions

Files: `lib/aihot.ts`, `lib/materials.ts`, `app/api/aihot/sync/route.ts`, `scripts/sync-aihot.mjs`, `tests/workflow.test.mjs`.

- [x] Add fixture pages for snapshot continuation, incremental upsert/remove, invalid page, network failure and expired cursor.
- [x] Implement `syncAIHOT()` as one bounded page per invocation with an expiring database lease. Atomically persist material versions, upserts and cursor. Use provider/external ID identity; preserve human notes, mark changed reviewed evidence stale, never delete withdrawn research records.
- [x] Publish `getSyncState()` for progress/error display. Rebuild snapshots with generation tracking and withdraw missing IDs only after all pages finish. Validate every page before advancing its cursor.
- [x] Verify page replay produces no duplicate records/revisions and failures resume at the same cursor.

## Task 3: Reports

Files: `lib/reports.ts`, `lib/db.ts`, `tests/workflow.test.mjs`.

- [x] Add tests for unknown/search-only materials, more than 40 candidates, valid/invalid model reference IDs, and saved evidence snapshots.
- [x] Select a bounded, topic-diverse direct-source set; disclose excluded and selected counts. Ask the model for JSON sections with fixed reference IDs; render URLs only from the selected set. Save each selected material snapshot with the report.
- [x] Remove the hardcoded trend conclusion and report-time URL crawling. On invalid model output, produce a factual digest from the same selected set.
- [x] Run `npm test` with no real provider calls.

## Task 4: Reader Workflow and Exports

Files: `components/Dashboard.tsx`, `components/SignalReview.tsx`, `components/AIHOTSync.tsx`, `styles.css`, `scripts/export-static-dashboard.mjs`, `README.md`.

- [x] Show direct/search/missing source, review state, unknown dates and upstream withdrawal independently of model confidence. Add review/notes and material revision details.
- [x] Add bounded sync/resume with explicit progress/error. Retain company/topic navigation and existing layouts.
- [x] Export the same evidence projection to static HTML without private notes or paid raw responses.
- [x] Run lint, build, static export; verify desktop/mobile and review/sync/report actions against a temporary database.

Verification: 9 automated tests passed. Browser QA used a database copy with paid model keys disabled: 600 AIHOT records imported across six pages, review/version display and digest report generation passed. Desktop 1440px and mobile 390px showed no horizontal overflow. Production build and lint passed. Static JSON contains 199 records and no private notes/raw payloads; both HTML exports are identical. Direct file-URL browser rendering was blocked by the browser policy, so static verification is structural rather than a claimed browser render. The real database was backed up before additive migration; all pre-existing signal fields remain identical to the backup. No QA records were copied into it.

## Task 5: Git Delivery

- [x] Inspect final diff and status. Confirm only task files are staged; report remaining limitations in README.
- Delivery procedure: commit on the existing `codex-refine-ai-dashboard` branch, fetch and check remote divergence, then push without force.
- Delivery acceptance: report the verified remote commit ID and local preview URL in the final handoff.
