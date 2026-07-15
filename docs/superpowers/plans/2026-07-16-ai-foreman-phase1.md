# AI Foreman — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development to execute
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stand up the Jobs pillar's Phase 1 — an owner-managed checklist library under Jobs (with
AI/trade starters) + automatic callback detection over completed jobs — the smallest slice that makes
the pillar visible AND starts the callback data flywheel the autopsy (Phase 2) will consume.

**Architecture:** Two independent workstreams, each landing as its own PR: **1A Checklists**
(give the headless `modules/checklists` backend an owner UI + an atomic update use-case + trade
starters + an AI-draft path) and **1B Callbacks** (additive `callback_of`/`callback_reason` on jobs
+ a pure detector + a confirm surface). Follows the hexagonal module pattern, the settings-tab UI
system (.field/.seg/list-first accordion, Modal shell), and the reviewed patterns from the booking
tab (trade-playbooks, add/starter modals) and crew-schedules (replace-all update).

**Tech stack:** Next 16 · tRPC v11 · Drizzle + Supabase RLS · Zustand · Vitest.

## Global Constraints

- **Design principles binding** (`.superpowers/sdd/design-principles.md`): SOLID/DI/ports/repository,
  DTO≠domain, validate at boundaries, no silent failures, YAGNI, immutability, small focused files.
- **Tenant safety (non-negotiable):** org id ALWAYS from `ctx.principal.orgId`, never client input.
  New tenant column/FK follows composite-FK `(org_id, x)→parent(org_id,id)` + `jobs` already has RLS.
  Every query org-scoped; repos also `eq(orgId)`.
- **UI house rules:** NO grey helper text under fields (labels + placeholders carry meaning); NO
  floating UI (in-flow); use the app design system (.field/.seg/.tsel/.btn/.card, Modal shell);
  functional copy; compact width-capped inputs; screenshot-self-review before reporting.
- **Full gate before each PR:** `npx tsc --noEmit` · `npm run lint` (0 errors) · `npm test` ·
  `npm run test:int` (live Supabase) · `npm run coverage` (80/75) · `npm run build`.
- **Migrations single-writer:** check `gh pr list` for open migration PRs before `db:generate`;
  hand-write RLS only for NEW tenant tables (none here — jobs has RLS; additive columns need none);
  verify the column exists live after `db:migrate`.
- TDD throughout; frequent commits; one implementer at a time per worktree.

---

## WORKSTREAM 1A — Checklists (PR: "Phase 1A — Checklists tab")

### Task 1A.1: Atomic "update checklist" use-case

**Files:** Modify `modules/checklists/domain/checklist-repository.ts` (add `update`),
`modules/checklists/infra/drizzle-checklist-repository.ts`, create
`modules/checklists/app/update-checklist.ts` + `.test.ts`, modify
`modules/checklists/api/checklist-router.ts` (+`update` mutation), `checklist-dto.ts`.

**Interfaces — Produces:** `UpdateChecklistUseCase.exec(cmd: { checklistId, name, items: { label,
type }[] }, orgId): Promise<Result<Checklist, AppError>>` — replaces the template's name + items
atomically (delete existing items, insert the new ordered set, in one tx), mirroring the
crew-schedules replace-all pattern. Validates via `Checklist.create`/`ChecklistItem.create`
(≤50 items, valid types). tRPC `v1.checklists.update`.

- [ ] **Step 1: Write the failing use-case test** — replace items on an existing template (fake
  repo): asserts repo.update called once with the new ordered items; a >50-item list → validation
  err (no write); item type not in `check|photo` → err. Do NOT import the module barrel.
- [ ] **Step 2: Run it — FAIL** (`npm test -- update-checklist`).
- [ ] **Step 3: Implement** the port method (`update(checklist, items)` — atomic delete+insert in the
  tenant tx), the use-case, the router mutation (`ownerOrOffice`, org from principal), the DTO input.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Integration test** (`drizzle-checklist-repository.int.test.ts`): create → update
  (items replaced, old gone) → list round-trip; RLS isolation (org B can't update org A's template).
- [ ] **Step 6: Commit** `feat(checklists): atomic update-checklist use-case (replace items)`.

### Task 1A.2: Trade starter checklists (static seed data)

**Files:** Create `app/(office)/settings/checklist-starters.ts` (+`.test.ts`) — a curated static
set, one authorship discipline as `trade-playbooks.ts`.

**Interfaces — Produces:** `CHECKLIST_STARTERS: { trade, label, checklists: { name, items: {label,
type}[] }[] }[]` covering the ICP trades; photo items placed on the steps that cause callbacks
(water-heater: expansion-tank + check-valve photos; AC: condensate-line photo; garage door:
spring-torque photo; etc.). `startersFor(tradeKey)`.

- [ ] **Step 1: Write the failing content test** — every trade present; every checklist ≤50 items;
  every item type in `check|photo`; NO `$` tokens anywhere (redaction hygiene — these get seeded, not
  spoken, but keep the discipline); at least one photo item per emergency-heavy trade's flagship job;
  names unique within a trade.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Author the seed set** (curated, per trade — mirror `trade-playbooks.ts` structure).
- [ ] **Step 4: Run — PASS. Commit** `feat(checklists): trade starter checklist seed data`.

### Task 1A.3: Checklists tab UI (nav + list + editor + starters/add modals)

**Files:** Modify `components/shell/section-tabs.tsx` + `components/shell/sidebar.tsx`
(`/jobs?tab=checklists` NavSub); modify `app/(office)/jobs/page.tsx` (render the checklists section
when `tab==="checklists"`); create `app/(office)/jobs/checklists-section.tsx`,
`checklist-editor-card.tsx`, `add-checklist-modal.tsx`, `starter-checklists-modal.tsx`; reuse
`components/modals/modal.tsx`, the checklists store slice/hydrator (already exist), and
`v1.checklists.{list,create,update,archive}`.

**Interfaces — Consumes:** `UpdateChecklistUseCase` contract (1A.1), `CHECKLIST_STARTERS` (1A.2),
the existing checklists store (list) + create/archive.

- [ ] **Step 1** (nav): add the `Checklists` NavSub under Jobs (mirror the Schedule/Timesheets
  entries) + the `section-tabs` entry; `active` when `tab==="checklists"`. Manual check the tab
  routes. Commit `feat(jobs): checklists sub-tab nav`.
- [ ] **Step 2** (list-first section): `checklists-section.tsx` — top row with `+ New checklist`
  (primary) + `Starter checklists` (ghost); a list-first accordion of the org's checklists (compact
  rows: name · N items; click → editor). Empty state → "Pick your trade to load starter checklists"
  CTA opening the starter modal (mirror the booking empty-state).
- [ ] **Step 3** (editor card): `checklist-editor-card.tsx` — name input + an ordered item list, each
  row = label input + a **Check / Photo** `.seg` toggle + remove; `+ Add step`; a red `Remove
  checklist`. Saves via `v1.checklists.update` (name + items) — debounced or explicit Save,
  consistent with the crew-hours dirty-Save pattern. Compact fields, no grey hints.
- [ ] **Step 4** (modals): `add-checklist-modal.tsx` (name → create empty, opens the editor);
  `starter-checklists-modal.tsx` (trade picker → preview the checklists it seeds → "Add N checklists"
  → batch-create via `v1.checklists.create`, dedupe by name). Mirror `add-service-modal` /
  `starter-playbook-modal`.
- [ ] **Step 5: Screenshot-verify** (dedicated port, owner@e2e creds): the tab, the list, an expanded
  editor with a Check + a Photo item, the starter modal previewing a trade. Iterate until it reads
  clean to a non-technical owner (the forms-ui bar). Reference paths in the report.
- [ ] **Step 6: Gate + commit** `feat(jobs): checklists tab — library, editor, trade starters`.

### Task 1A.4 (optional, can defer within 1A): AI-draft a checklist

**Files:** Create `modules/checklists/app/draft-checklist.ts` (+test) using the existing agent/LLM
seam; a `v1.checklists.draft` mutation; a "✨ Draft with AI" button in `add-checklist-modal.tsx`.

**Interfaces — Produces:** `draftChecklist({ jobType: string }, orgId): Promise<{ items: {label,
type}[] }>` — prompts the LLM for a before-you-leave checklist for the job type, returns proposed
items the owner edits + saves (suggest, never auto-apply; no dollar amounts).

- [ ] Steps: failing test (fake LLM port returns items → mapped to the proposed shape; malformed →
  empty, no throw) → implement → wire the button (fills the editor, owner saves) → screenshot →
  commit `feat(checklists): AI-draft a checklist for a job type`.
- [ ] If time-boxed, this task may land in a follow-up PR — 1A ships value without it (static
  starters cover cold-start).

**→ Full gate, then PR: "Phase 1A — Checklists tab + starters".**

---

## WORKSTREAM 1B — Callback detection (PR: "Phase 1B — Callback detection")

### Task 1B.1: `callback_of` + `callback_reason` on jobs (schema + domain)

**Files:** Modify `shared/db/schema/jobs.ts` (2 columns + self-FK), generate migration; modify
`modules/jobs/domain/job.ts` (`JobProps` + `JobCreateProps` optional passthrough, normalize),
`modules/jobs/app/create-manual-job.ts` (command passthrough), `job-mapper.ts`,
`drizzle-job-repository.ts` (mutableColumns), `job-dto.ts` (passthrough).

**Interfaces — Produces:** `jobs.callbackOf: JobId | null`, `jobs.callbackReason: string | null`
(`"callback" | "new_issue" | "found_work"` — validated in domain). Self-FK `(org_id, callback_of) →
jobs(org_id, id)`. Migration additive (jobs has RLS → no RLS migration); verify columns live.

- [ ] Steps (mirror the `jobs.scope` passthrough exactly — Phase 3 of the frontdesk build):
  failing domain test (default null; set + preserved; invalid reason → validation err) → schema +
  `db:generate` (pure ADD COLUMN + ADD CONSTRAINT; strip drift) → `db:migrate` + verify live →
  domain/mapper/repo/DTO passthrough → int round-trip test → commit
  `feat(jobs): callback_of + callback_reason columns on jobs`.

### Task 1B.2: Pure callback detector

**Files:** Create `modules/jobs/app/detect-callbacks.ts` (+`.test.ts`).

**Interfaces — Produces:**
```ts
export interface CallbackCandidate { jobId: JobId; originalJobId: JobId; }
// Pure. For each job, find the most recent COMPLETED job with the SAME customer (leadId) and the
// SAME service (svc, case-insensitive trim), completed within WINDOW_DAYS (=45) BEFORE this job's
// scheduled/created time. Excludes the job itself, canceled jobs, and jobs already flagged
// (callbackOf set). Returns candidate links.
export function detectCallbacks(jobs: readonly JobLite[], windowDays?: number): CallbackCandidate[];
```
`JobLite = { id, leadId, svc, status, completedAt, createdAt, callbackOf }`. No I/O.

- [ ] Steps: failing tests — a same-customer same-service job 10 days later → candidate; 60 days
  later → NOT (outside window); different service → NOT; different customer → NOT; the original job
  itself never a candidate; a job already `callbackOf`-set → skipped; canceled originals excluded;
  ties → most recent completed original wins. → implement (pure, well-commented, <50-line fns) →
  PASS → commit `feat(jobs): pure callback detector (same customer+service, 45-day window)`.

### Task 1B.3: Candidate read + confirm mutation + surface

**Files:** Modify `modules/jobs/infra/drizzle-job-repository.ts` (a reader:
`listRecentForCallbackScan()` — completed + recent jobs, org-scoped) or an availability-style reader;
create `modules/jobs/app/confirm-callback.ts` (+test); modify `modules/jobs/api/job-router.ts`
(`callbackCandidates` query = run detector over the reader; `confirmCallback` mutation = set
callbackOf + reason, or dismiss); a minimal UI surface.

**Interfaces — Produces:** `v1.jobs.callbackCandidates` → `{ jobId, originalJob: {num, svc, when} }[]`;
`v1.jobs.confirmCallback({ jobId, originalJobId, reason })` and `v1.jobs.dismissCallback({ jobId })`
(dismiss = a sentinel so it stops resurfacing — e.g. `callbackReason="new_issue"` with null
callbackOf, or a dismissed flag; pick the simplest that doesn't recompute forever).

- [ ] Steps: failing confirm-use-case test (sets callbackOf+reason; dismiss marks non-candidate) →
  implement reader (org-scoped, no N+1) + use-cases + router → int test (two same-customer
  same-service jobs → candidate surfaces; confirm links them; RLS isolation) →
  **UI:** a small confirmable banner on the job detail/row ("Looks like a callback of JOB-123 —
  Confirm / Not a callback") + a `Callbacks` count on the Jobs list (minimal — the full autopsy card
  is Phase 2). Screenshot-verify. → gate → commit `feat(jobs): callback candidates + confirm surface`.

**→ Full gate, then PR: "Phase 1B — Callback detection".**

---

## Execution notes

- 1A and 1B are independent — either order; each branches off latest `main`, one PR, Owen merges,
  next off updated main (his cadence — verify PR OPEN before any follow-up push; recover stranded
  commits with a fresh branch).
- Recurring review lenses: tenant scoping on every new query; graceful-degrade (a detector/read miss
  never blocks job creation); the checklist update's atomicity (replace-all in one tx); UI against
  the forms-ui bar; no grey helper text.
- Phase 2 (the autopsy card) consumes 1B's `callback_of` data + 1A's per-item answers — do NOT build
  it here; this plan only produces the standard + the clean callback dataset.

## Self-review (done)

- Spec coverage: 1a (tab) → 1A.3; 1c (starters + AI-draft) → 1A.2/1A.4; 1d (callback detection) →
  1B.1–1B.3; the deferred auto-attach + autopsy are explicitly out. ✓
- Type consistency: `callbackOf`/`callbackReason`, `CallbackCandidate`, `UpdateChecklistUseCase`,
  `CHECKLIST_STARTERS` used consistently across tasks. ✓
- No placeholders: each task names exact files, the produced interface, and TDD steps. The two
  "optional/minimal" scopes (1A.4 AI-draft, 1B.3 UI surface) are flagged as such deliberately. ✓
