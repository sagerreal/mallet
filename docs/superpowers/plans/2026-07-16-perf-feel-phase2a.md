# Perf & Feel — Phase 2a (Field-First)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. One
> implementer per task, adversarial review per task, measurement before the PR.

**Goal:** Finish the FIELD feel — the surface Owen named. Phase 1 left: field tab switch p50 153ms
(the my-hours `timesheets.list` fetch blocks content — the route JS is already prefetched by Link),
the 1468-line tech-job-modal re-rendering wholesale on every checklist tap (subscribes to the whole
`s.jobs` array at :1236; its sections aren't memoized), no route-change crossfade, and `/jobs/[id]`
blocking on a fetch for a job the store usually already has. Target: field tab p50 <60ms, a
checklist tap re-renders ONLY the checklist section, nav reads press → crossfade → content.

## Global Constraints

- Design principles binding (`docs/design-principles.md`). NO markup/visual redesign anywhere — the
  field UI's structure is Owen-approved; these are subscription/scheduling/caching changes plus one
  config flag. Tenant safety untouched.
- Diagnosis facts to trust (verified): `reconcileJob` preserves object identity for untouched jobs
  (`jobs.map` only replaces the matched id) — so a `find(j => j.id === id)` selector returns a
  STABLE reference across unrelated writes. Link prefetches route JS; the tab lag is data.
- Full gate before the PR: `npx tsc --noEmit` · `npm run lint` (0 errors) · `npm test` ·
  `npm run coverage` (80/75) · `npm run build`.

---

### Task A1: Field data prefetch + View Transitions

**Files:** the field layout/shell (`app/(field)/layout.tsx` or the field hydrator —
`features/field/field-jobs-hydrator.tsx`; pick the mounted-once client component) ·
`app/(field)/my-hours/page.tsx` (staleTime alignment) · `next.config.ts` · `app/globals.css`.

1. **Prefetch the sibling tabs' data once the field shell is idle:** in the mounted-once field
   client component, after the my-day query settles, `const utils = api.useUtils();` then
   `utils.v1.timesheets.list.prefetch(<the exact input my-hours uses>)` (+ the messages query if
   it fetches on mount — check). Guard: run once per mount (ref), `requestIdleCallback` with a
   `setTimeout` fallback. The my-hours page's `useQuery` must then mount into cache: give the SAME
   query input and ensure its options don't force refetch (staleTime — global default is 30s; align
   the prefetch's staleTime so a tab switch within a normal session hits cache).
2. **View Transitions:** `next.config.ts` → `experimental: { viewTransition: true }`;
   `app/globals.css` → `@view-transition{navigation:auto}` +
   `::view-transition-old(root),::view-transition-new(root){animation-duration:120ms}`. Verify
   `npm run build` is clean and dev nav still works; if the flag breaks ANYTHING (build, hydration
   warnings, modal behavior), REVERT the flag, keep the CSS harmless, and report — the flag is the
   only experimental item in the whole workstream.
- [ ] Gate + a quick dev-server check that My day → My hours after idle shows content with no
  skeleton flash. Commit `perf(field): idle-prefetch sibling tab data + view transitions`.

### Task A2: tech-job-modal render cost — by-id subscription + memoized sections

**Files:** `components/modals/tech-job-modal.tsx` ONLY (no file split — that's Phase 2b).

1. Replace `const jobs = useAppStore((s) => s.jobs)` (:1236) with a by-id selector for the open
   job (find how the modal receives its job id — the modal-host key/props) —
   `useAppStore((s) => s.jobs.find(j => j.id === jobId))` returns a stable ref for unrelated
   writes. Audit the file for OTHER wide subscriptions (leads/invoices arrays) and narrow each to
   what the modal actually reads (by-id or primitive), same pattern.
2. `React.memo` the section components (`WorkOrderSec`, `FoundWorkSec`, `ChecklistSec`, the note
   feed, the timer if separate) and make their props stable: primitive/by-ref-stable data + 
   `useCallback` for the handlers passed down. Goal (verify with a render-count probe like P4's
   shell test, or a temporary counter in dev): ONE checklist tap commits ChecklistSec (optimistic +
   reconcile waves) and does NOT commit WorkOrderSec/FoundWorkSec/the parent shell.
3. ZERO markup changes — subscriptions, memo wrappers, and callbacks only.
- [ ] Extend or add an RTL render test if practical (the P4 pattern) — else document the probe
  method + numbers. Gate. Commit `perf(field): tech-job-modal by-id subscription + memoized sections`.

### Task A3: `/jobs/[id]` cache-first

**Files:** `features/jobs/hooks.ts` (`useJob`) or the page — smallest correct change.

1. The store's jobs list usually already holds the job (hydrator ceiling 500). Render it
   immediately: `useJob` gains `placeholderData` derived from the store
   (`useAppStore(s => s.jobs.find(...))` mapped to the DTO shape the page reads — CHECK the shape
   gap: the page reads the tRPC jobDTO; the store job is the mapped store shape. If mapping back is
   lossy/awkward, do it at the PAGE level instead: render from the store job when present while
   `job.isLoading`, swap to the fetched DTO when it lands — choose the cleaner of the two and
   justify in the report).
2. The background fetch stays (fresh data replaces placeholder); the P1 skeleton remains for the
   genuinely-cold case (deep link to an archived job).
- [ ] Gate. Commit `perf(office): cache-first job detail (store placeholder, background refresh)`.

### Task A4: Measure + record (gates the PR)

- Re-run the P5 field measurement: mtab switch p50/p95 ×15 @4x throttle (target p50 <60ms after
  idle prefetch); checklist-tap commit counts in the tech-job-modal (before: whole modal ×2 waves;
  after: ChecklistSec only — document the probe); office /jobs/[id] click→content with a warm
  store. Nav crossfade recording if the flag survived. Artifacts under /tmp/tqshot/perf/2a/.
- [ ] Write `.superpowers/sdd/task-A4-report.md`; numbers go in the PR body.

**→ Full gate, then ONE PR: "perf: Phase 2a — field-first (prefetch, modal render cost, view transitions, cache-first job)".**

## Self-review (done)

- Field-first per Owen's complaint; each task is subscription/caching/config only — no visual or
  structural redesign; the modal file-split and bootstrap query stay in Phase 2b. ✓
- The one experimental item (viewTransition) carries an explicit revert path. ✓
