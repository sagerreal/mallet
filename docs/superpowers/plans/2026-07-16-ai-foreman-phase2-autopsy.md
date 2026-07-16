# AI Foreman — Phase 2: Callback Autopsy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development to execute
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the confirmed-callback dataset (Phase 1B) into the pillar's payoff — a **Callback
Autopsy card** on the Jobs surface that groups callbacks by service, correlates each cluster to the
checklist step most often skipped/overridden on the original jobs, and offers a **one-tap "make that
step required"** edit to the template. Counts + linkage ship for all callbacks; the per-item "leak"
insight lights up wherever the original job carried an answered checklist.

**Architecture (approved design):** A pure aggregation function is the testable heart (mirrors the
1B.2 detector): a reader loads confirmed callbacks + their original jobs' checklist snapshots, the
existing batched `listExecutionForJobs` supplies each original's verify answers, and
`computeAutopsy(...)` ranks per-service clusters and their top missed step. A thin use-case + tRPC
query expose it; a card on the Jobs surface renders it and wires the one-tap fix into the EXISTING
`v1.checklists.update` (1A). No schema change, no new completion surface (the field surface that
writes `job_verify_answers` already exists), no auto-attach (attachment stays manual — a job's `svc`
is only reliable when captured by the AI front desk).

**Tech stack:** Next 16 · tRPC v11 · Drizzle + Supabase RLS · Zustand/react-query · Vitest.

## Global Constraints

- **Design principles binding** (`docs/design-principles.md`): hexagonal
  (router→use-case→domain/pure→repo), DTO≠domain, `Result` returns (no throws for expected
  validation), validate at boundaries, no silent failures, immutability, YAGNI, no `any`, small
  focused files (<800 lines, fns <50).
- **Tenant safety (non-negotiable):** org id ALWAYS from `ctx.principal.orgId`, never client input.
  Every new reader is org-scoped (`eq(jobs.orgId, this.orgId)`) AND runs under RLS via `ctx.tx`.
- **Read-only analysis:** the autopsy computes over existing data — it MUST NOT write jobs or answers.
  The ONLY write is the one-tap template edit, which goes through the existing `UpdateChecklistUseCase`
  (1A) — do not add a new checklist-write path.
- **Graceful degradation:** where an original job has no attached/answered checklist, the cluster
  shows counts + linkage only (no fabricated leak). A cluster with zero answered originals must never
  invent a `topMiss`. A miss-rate of 0 → `topMiss: null`.
- **UI house rules:** NO grey helper text; NO floating UI (in-flow, anchored); functional copy; use
  the app design system of the surface you edit; the card lives on the JOBS surface (Home stays
  untouched); screenshot-self-review before reporting.
- **Full gate before the PR:** `npx tsc --noEmit` · `npm run lint` (0 errors; ~165 legacy warnings
  OK) · `npm test` · `npm run test:int` (live Supabase; full suite can HANG on shared-DB contention —
  fall back to `npm run test:int -- drizzle-job-repository`, note the hang, don't treat it as a
  failure) · `npm run coverage` (80/75) · `npm run build`.
- TDD throughout; one implementer at a time per task; adversarial review per task.

---

### Task 2.1: Autopsy reader — confirmed callbacks + their originals' checklist snapshots

**Files:** Modify `modules/jobs/domain/job-repository.ts` (port + row type),
`modules/jobs/infra/drizzle-job-repository.ts` (implement); extend
`modules/jobs/infra/drizzle-job-repository.int.test.ts`.

**Interfaces — Produces:**
```ts
// A confirmed callback paired with a projection of the original job it repeats.
export interface AutopsyPairRow {
  readonly callback: { readonly id: JobId; readonly num: string; readonly svc: string | null; readonly completedAt: Date | null };
  readonly original: { readonly id: JobId; readonly num: string; readonly svc: string | null;
    readonly completedAt: Date | null; readonly checklist: JobChecklistProps | null };
}
// Org-scoped. Confirmed callbacks (callbackReason === "callback", callbackOf non-null) whose CALLBACK
// job was created on/after `since`, each stitched to its original job (loaded by callbackOf id).
// Non-deleted only. If an original id is missing (deleted), drop that pair. No N+1 beyond two queries.
listConfirmedCallbacksWithOriginals(since: Date): Promise<AutopsyPairRow[]>;
```
Implementation: (1) select confirmed callback rows from `jobs` — conds
`[isNull(deletedAt), eq(orgId, this.orgId), eq(callbackReason, "callback"), isNotNull(callbackOf),
gte(createdAt, since)]`, projecting `id, num, svc, completedAt, callbackOf`. (2) collect distinct
`callbackOf` ids; if empty return `[]`. (3) select originals by `inArray(jobs.id, originalIds)` +
`eq(orgId, this.orgId)` + `isNull(deletedAt)`, projecting `id, num, svc, completedAt, checklist`.
(4) build a `Map` of originals and stitch each callback to its original, dropping pairs whose original
is absent. Deep-copy the `checklist` jsonb into `JobChecklistProps | null` via the SAME normalization
the mapper uses (reuse `toChecklistProps`/the existing snapshot reader helper — do not re-hand-roll).

- [ ] **Step 1: Write the failing int test** in `drizzle-job-repository.int.test.ts`: seed org A with an
  original job (completed, with a `checklist` snapshot set via `update`) and a later job confirmed as a
  callback of it (`callbackOf`, `callbackReason:"callback"`); assert `listConfirmedCallbacksWithOriginals(since)`
  returns one pair with the right nums + the original's checklist; assert a `new_issue`/`null`-reason
  job is NOT returned; assert org B's confirmed callback is NOT returned (RLS/org-scope isolation);
  assert a callback older than `since` is excluded.
- [ ] **Step 2: Run it — FAIL** (`npm run test:int -- drizzle-job-repository`).
- [ ] **Step 3: Implement** the port type + method (two queries + stitch, org-scoped).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(jobs): autopsy reader — confirmed callbacks + originals' checklists`.

### Task 2.2: Pure autopsy aggregation

**Files:** Create `modules/jobs/app/compute-autopsy.ts` + `.test.ts`.

**Interfaces — Produces:**
```ts
import type { JobChecklistProps } from "../domain/job";
import type { VerifyState } from "../domain/job-execution";

export interface AutopsyPair {
  readonly callback: { readonly id: string; readonly num: string; readonly svc: string | null };
  readonly original: { readonly id: string; readonly num: string; readonly svc: string | null;
    readonly checklist: JobChecklistProps | null };
}
// Per-original verify answers keyed by original job id: itemId → state ("pass" | "override").
export type AnswersByOriginal = ReadonlyMap<string, ReadonlyMap<string, VerifyState>>;

export interface AutopsyTopMiss {
  readonly itemText: string;       // the step most often missed in this cluster
  readonly checklistName: string;  // the snapshot's checklist name (used to find the template to edit)
  readonly missCount: number;      // originals (with a checklist) that MISSED this step
  readonly ofAnswered: number;     // originals in the cluster that carried a checklist (the denominator)
  readonly alreadyRequired: boolean; // true if the item is already required in every snapshot it appears in
}
export interface AutopsyCluster {
  readonly service: string;              // display label (svc, or "Other" when null)
  readonly callbackCount: number;
  readonly originalNums: readonly string[];   // for "here are the original jobs"
  readonly answeredOriginals: number;    // how many originals had an attached checklist
  readonly topMiss: AutopsyTopMiss | null;    // null when no answered originals / no misses
}
// Pure. Groups pairs by service, ranks the most-missed step per cluster. Deterministic.
export function computeAutopsy(pairs: readonly AutopsyPair[], answers: AnswersByOriginal): AutopsyCluster[];
```
Logic (extract small helpers, each <50 lines):
- **Group** pairs by `serviceKey = (p.callback.svc ?? p.original.svc ?? "").trim().toLowerCase()`;
  the display `service` = the first non-empty original of svc/callback svc in the group, else `"Other"`.
- **Miss detection** for one original: for each item in `original.checklist.items`, it is MISSED when
  the answers map for that original has NO entry for `item.id` with state `"pass"` (i.e. unanswered OR
  `"override"`). Only originals WITH a non-null checklist count toward `answeredOriginals`.
- **Aggregate misses by item TEXT** (case-insensitive+trim) across the cluster's answered originals
  (snapshot item ids differ per job, so text is the join key). `topMiss` = the text with the highest
  `missCount`; tiebreak by higher miss-rate, then alphabetical (deterministic). `checklistName` = the
  snapshot name from any original that has that missed item. `alreadyRequired` = whether every snapshot
  occurrence of that item had `required === true`.
- `topMiss` is `null` when `answeredOriginals === 0` or the top miss count is 0.
- **Sort** clusters by `callbackCount` desc, then `service` asc.

- [ ] **Step 1: Write failing tests** — (a) two water-heater callbacks whose originals both skipped the
  same step → cluster with `callbackCount:2`, correct `topMiss.itemText`, `missCount:2`, `ofAnswered:2`;
  (b) an original with the step ANSWERED `pass` → not counted as a miss; (c) `override` → counts as a
  miss; (d) originals with NO checklist → `answeredOriginals:0`, `topMiss:null`, but `callbackCount`
  still counts; (e) two services → two clusters sorted by count; (f) tie broken deterministically;
  (g) `alreadyRequired` true when the snapshot item was required. Assert exact objects; no `.only`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** the pure function + helpers (well-commented, immutable, no I/O, no `any`).
- [ ] **Step 4: Run — PASS. Commit** `feat(jobs): pure callback-autopsy aggregation`.

### Task 2.3: Autopsy use-case + tRPC query + DTO

**Files:** Create `modules/jobs/app/callback-autopsy.ts` + `.test.ts`; modify
`modules/jobs/api/job-dto.ts` (DTO) and `modules/jobs/api/job-router.ts` (query).

**Interfaces — Consumes:** `listConfirmedCallbacksWithOriginals` (2.1), `listExecutionForJobs` (exists),
`computeAutopsy` (2.2). **Produces:** `CallbackAutopsyUseCase.exec(): Promise<Result<AutopsyCluster[], AppError>>`
and tRPC `v1.jobs.callbackAutopsy` (query, `ownerOrOffice`, no input) → `z.array(autopsyClusterDTO)`.

- [ ] **Step 1: Write the failing use-case test** (fake repo + fake clock; no barrel import): repo
  returns two pairs + an answers map → use-case returns the `computeAutopsy` clusters. Assert the
  use-case computes `since` from the clock (define `AUTOPSY_WINDOW_DAYS = 90` in the use-case file),
  calls `listExecutionForJobs` with the distinct original ids, and builds the `AnswersByOriginal` map
  from each original's `verifyAnswers` (itemId → state). Empty repo → `[]`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** the use-case (reader → collect original ids → `listExecutionForJobs` →
  build answers map → `computeAutopsy` → ok(clusters)); add `autopsyClusterDTO` (+ nested topMiss) to
  `job-dto.ts` and a `toAutopsyClusterDTO` mapper; wire the `callbackAutopsy` query in `job-router.ts`
  (construct `DrizzleJobRepository(ctx.tx, ctx.principal.orgId)`, `ctx.deps.clock`).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Integration test** (`drizzle-job-repository.int.test.ts` or a small router-level int):
  two same-service confirmed callbacks whose originals share a skipped step (seed originals with a
  checklist + a tech `override`/absent answer) → the use-case returns one cluster with the expected
  `topMiss`. RLS: another org's callbacks don't appear.
- [ ] **Step 6: Commit** `feat(jobs): callback-autopsy use-case + query`.

### Task 2.4: Autopsy card on the Jobs surface + one-tap "make required"

**Files:** Create `features/jobs/callback-autopsy-card.tsx`; add a hook to `features/jobs/hooks.ts`
(`useCallbackAutopsy` = `api.v1.jobs.callbackAutopsy.useQuery()`, and reuse the checklists store's
`updateChecklist` for the one-tap edit); render the card on the Jobs surface (`features/jobs/jobs-home.tsx`
or the Checklists tab context — place it where the callback count already lives, above the list).

**Interfaces — Consumes:** `v1.jobs.callbackAutopsy` (2.3), the checklists store slice
`updateChecklist(id, name, items)` (1A) + `v1.checklists.list` to resolve the template by name.

- [ ] **Step 1** (card, read-only first): `callback-autopsy-card.tsx` renders when
  `useCallbackAutopsy().data` has clusters. Per cluster: a compact row — `{service} · {callbackCount}
  callback{s}` and, when `topMiss`, a line `Most-missed step: "{itemText}" ({missCount} of {ofAnswered})`;
  when `topMiss` is null, `Attach a checklist to catch the cause next time.` Show `originalNums` as
  small refs. In-flow, anchored, design-system classes, NO grey helper text. Hidden entirely when
  there are zero clusters. Manual-check it renders against seeded data.
- [ ] **Step 2** (one-tap fix): when `topMiss && !topMiss.alreadyRequired`, show a `Make required`
  primary button. On click: look up the library template whose `name === topMiss.checklistName` and
  `stage === "job"` from the checklists store; find its item by `text === topMiss.itemText`
  (case-insensitive+trim); rebuild its items with that item's `required` set true; call
  `updateChecklist(template.id, template.name, items)`. On success show `Required ✓` inline and
  refetch the autopsy (`api.useUtils().v1.jobs.callbackAutopsy.invalidate()`). If no template matches
  (renamed/deleted), fall back to a link that opens the Checklists tab (functional copy, no dead
  button). Surface errors with `userMessage`. When `alreadyRequired`, show `Already required` (no tap).
- [ ] **Step 3: Screenshot-verify** (dedicated PORT, owner@e2e creds): seed a confirmed callback whose
  original has an answered checklist with a skipped step; verify the card shows the cluster, the
  most-missed line, and the `Make required` button; tap it; verify the template item flips to required
  in the Checklists tab and the card updates. Reference screenshot paths in the report. Iterate until
  it reads clean to a non-technical owner (the forms-ui bar).
- [ ] **Step 4: Gate + commit** `feat(jobs): callback autopsy card + one-tap make-required`.

**→ Full gate, then PR: "Phase 2 — Callback Autopsy".**

---

## Execution notes

- Branch `feat/callback-autopsy` off latest `main` (already includes #107). One PR; Owen merges;
  verify the PR is still OPEN before any follow-up push (his cadence — recover stranded commits with a
  fresh branch + new PR).
- Recurring review lenses: tenant scoping on every new reader; the analysis NEVER writes jobs/answers
  (only the one-tap template edit writes, via the existing 1A path); `topMiss` never fabricated when
  there are no answered originals; the item→template resolve has a graceful no-match fallback; UI
  against the forms-ui bar with no grey helper text.
- Data reality (see the [[ai-foreman-pillar]] memory): attachment is manual and answers accrue only on
  jobs a tech completed in the field, so real per-item leaks are sparse in production and rich in a
  seeded demo org — the card degrades to counts gracefully. This is expected, not a bug.

## Self-review (done)

- Spec coverage: card location (Jobs) → 2.4; counts+linkage → 2.2/2.4; per-item leak → 2.1/2.2;
  one-tap fix via existing 1A update → 2.4; no auto-attach / no new completion surface / no schema
  change → honored across all tasks. ✓
- Type consistency: `AutopsyPairRow`/`AutopsyPair`, `AutopsyCluster`/`AutopsyTopMiss`,
  `AnswersByOriginal`, `computeAutopsy`, `CallbackAutopsyUseCase`, `AUTOPSY_WINDOW_DAYS` used
  consistently across tasks; `VerifyState` reused from `job-execution.ts`. ✓
- No placeholders: each task names exact files, the produced interface, and TDD steps with real
  assertions. The one genuinely fuzzy bit (item→template resolve by name+text) is specified with its
  fallback. ✓
