# Skill-Aware Dispatch (Right Tech for the Job) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development to execute
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make dispatch skill-aware end-to-end: techs carry **certification tags** (Gas, Boiler,
Panel…), each booking-playbook service carries **required certs**, jobs inherit the requirement at
create time, the AI front desk's auto-assign only picks qualified techs (none qualified → the booking
completes UNASSIGNED into To-schedule), and the office surfaces get **suggest-only** qualified-tech
hints (job modal banner + Crew-select annotation + board lane badge). Never block a human assignment.

**Approved design (Owen, Jul 16 2026):** certification tags (not seniority levels); the requirement
lives per-service in Booking settings (jobs inherit — zero per-job effort); suggest-never-block on
office surfaces; AI fallback = unassigned + visible "why" (computed live, no extra flag column).

**Architecture:** One pure, client-bundle-safe gate module (`shared/dispatch/skill-gate.ts` — types
only, no drizzle/config imports, mirroring `modules/frontdesk/app/dispatch.ts`'s purity) used by BOTH
paths. Server: filter `CrewLoad` candidates by `meetsRequirement` between `readSameDayCrewLoads` and
`chooseCrew` in `assignCrew` (`modules/frontdesk/app/tools/book-visit.ts:300-315`); `dispatch.ts`
itself unchanged. Client: thread `skillTags` through the members DTO → techs-hydrator → Tech store
type (replacing the dead `skills: []` stub), and `requiredCerts` through jobDTO → store; annotate.

**Tech stack:** Next 16 · tRPC v11 · Drizzle + Supabase RLS · Zustand · Vitest.

## Global Constraints

- **Design principles binding** (`.superpowers/sdd/design-principles.md`): hexagonal, DTO≠domain,
  `Result` returns, validate at boundaries, no silent failures, immutability, YAGNI, no `any`,
  fns <50 lines, files <800.
- **Tenant safety (non-negotiable):** org id ALWAYS from `ctx.principal.orgId`; every new query
  org-scoped + RLS via `ctx.tx`. `users` and `jobs` both already have RLS → additive columns need
  NO new RLS migration.
- **Migrations single-writer:** check `gh pr list` for open migration PRs before `db:generate`;
  next number is **0080** (verify — may shift); ALWAYS verify the column exists live after
  `db:migrate` (silent no-op on collision is a known failure mode).
- **The zod strip trap:** `bookingServiceDTO` (`modules/settings/api/settings-dto.ts:8`) silently
  strips unknown keys — `requiredCerts` MUST be added there or it vanishes on every settings save.
  A round-trip test is mandatory.
- **Board scar tissue:** Owen has rejected schedule-board restructures ~4 times. Everything on
  `schedule-panel.tsx` is additive annotation ONLY (className modifier, one banner line). NEVER
  disable a drop, NEVER add a panel/popover (no-floating-UI rule).
- **Cert matching is normalized everywhere:** trim + case-insensitive; display casing preserved.
  All comparisons go through the pure gate module — never inline, never in SQL WHERE.
- **UI house rules:** NO grey helper text; NO floating UI; functional copy; design-system classes;
  screenshot-self-review for UI tasks.
- **Full gate before the PR:** `npx tsc --noEmit` · `npm run lint` (0 errors) · `npm test` ·
  `npm run test:int` (full suite may HANG on shared-DB contention — fall back to the task-specific
  int files, note it) · `npm run coverage` (80/75) · `npm run build`.
- TDD throughout; one implementer at a time; adversarial review per task.

## Non-goals (v1 — stated, not accidental)

- The job-level assignee path (`features/jobs/job-actions.tsx` → `v1.jobs.assign`, all org members)
  stays ungated — it's the JOB-level assignee, distinct from visit dispatch.
- Estimate-visit (`placeEvisit`) placements are store-only today (never persist) — out of scope.
- The board's hard-coded 8h capacity / `crew_schedules` gap — separate follow-up.
- No seniority levels, no tag taxonomy management page (free-form org-defined words; normalized
  matching absorbs casing drift).

---

### Task 1: Pure skill gate — `shared/dispatch/skill-gate.ts`

**Files:** Create `shared/dispatch/skill-gate.ts` + `skill-gate.test.ts`.

**Interfaces — Produces (every later task consumes these; client-bundle-safe, zero imports):**
```ts
/** trim + casefold — the ONLY normalization used for cert comparison anywhere. */
export function normCert(s: string): string;

/** null/undefined/[] required → true. Else every required cert (normalized) ∈ techCerts (normalized). */
export function meetsRequirement(
  techCerts: readonly string[],
  required: readonly string[] | null | undefined,
): boolean;

/** The display-cased required entries the tech lacks ([] when qualified / no requirement). */
export function missingCerts(
  techCerts: readonly string[],
  required: readonly string[] | null | undefined,
): string[];

/** Normalized EXACT name match over the booking services; returns the entry's requiredCerts,
 *  or null when: no name match, no requiredCerts, or requiredCerts is empty. */
export function resolveServiceRequirement(
  services: readonly { name: string; requiredCerts?: readonly string[] }[],
  text: string | null | undefined,
): string[] | null;
```

- [ ] **Step 1: Failing tests** — subset pass; missing one cert → false + `missingCerts` names it
  (display casing); empty/null/undefined required → qualified, `missingCerts` = []; case+trim
  insensitivity both sides ("  GAS " matches "gas"); `resolveServiceRequirement`: exact-normalized
  match returns the certs, paraphrase/no-match → null, matched entry with no/empty certs → null.
- [ ] **Step 2: FAIL → implement (pure, commented like `dispatch.ts`) → PASS.**
- [ ] **Step 3: Commit** `feat(dispatch): pure skill gate (cert subset matching)`.

### Task 2: Tech certs vertical slice (schema → identity API → Team UI)

**Files:** Modify `shared/db/schema/users.ts` (+ migration **0080**),
`modules/identity/api/identity-router.ts` (members output + new mutation),
`features/team/techs-hydrator.tsx`, `lib/store/types.ts` (Tech),
`app/(office)/settings/page.tsx` (MemberRow control); int test in the identity int suite.

**Interfaces — Produces:** `users.skill_tags text[] NOT NULL DEFAULT '{}'`;
`v1.identity.members` rows gain `skillTags: string[]`;
`v1.identity.setMemberSkillTags({ userId, skillTags: string[] })` (each tag 1–40 chars trimmed,
max 10, ownerOrOffice, org-scoped — **clone the `setMemberFieldCrew` pattern at
identity-router.ts:409-443 exactly**: org-scoped update + `.returning()` DTO + NOT_FOUND guard + log);
store `Tech.skills: string[]` now REAL (replace the `skills: []` stub in `toStoreTech` — reuse the
existing field name, don't add a second).

- [ ] **Step 1: Failing int test** — members returns `skillTags` (default []); `setMemberSkillTags`
  round-trip persists + normalizes trim; >10 tags / empty tag → validation error; org B cannot set
  org A's member (NOT_FOUND via org scope).
- [ ] **Step 2: Schema + `db:generate` → 0080 (purely additive ALTER; strip drift) → `db:migrate` →
  VERIFY the column exists live (house gotcha).** No RLS migration (users RLS is FOR ALL, 0003).
- [ ] **Step 3: Router + hydrator + Tech type threading → int test PASS.**
- [ ] **Step 4: Team UI** — in `MemberRow` (settings page), for `isFieldCrew` members: a compact
  in-flow cert chips editor (chip = tag + ✕; a small input + Add; mirror the Call-rules tag-chips
  pattern from the booking tab). Saves via `setMemberSkillTags`. NO grey helper text. Screenshot.
- [ ] **Step 5: Commit** `feat(team): per-tech certification tags`.

### Task 3: Per-service required certs (the 3 shape copies + Settings UI)

**Files:** Modify `lib/store/slices/settings-slice.ts:54-61` (BookingService),
`modules/settings/domain/org-settings.ts:17-27`, `modules/settings/api/settings-dto.ts:8-15`
(**the strip trap — mandatory**), `app/(office)/settings/booking-service-card.tsx` (ExpandedEditor +
collapsed-row chip); round-trip test.

**Interfaces — Produces:** `BookingService.requiredCerts?: string[]` (optional, jsonb — NO DB
migration) on ALL THREE copies; zod: `requiredCerts: z.array(z.string().min(1).max(40)).max(10).optional()`.

- [ ] **Step 1: Failing round-trip test** — save a booking playbook whose service carries
  `requiredCerts: ["Gas"]` through the settings save path → read back → the field SURVIVES the zod
  boundary (this fails before the DTO edit — proving the strip trap).
- [ ] **Step 2: Add the field to all three copies → PASS.**
- [ ] **Step 3: Settings UI** — in the service ExpandedEditor: a `Certifications required` chips
  editor (same chip pattern as Task 2, `updateBookingService(index, "requiredCerts", …)`); on the
  collapsed row: a small chip listing the certs when set (mirror the existing chips fn). Screenshot.
- [ ] **Step 4: Commit** `feat(settings): per-service required certifications`.

### Task 4: Job inherits the requirement + the AI dispatch gate

**Files:** Modify `shared/db/schema/jobs.ts` (+ migration **0081**), `modules/jobs/domain/job.ts`
(+ create-manual-job, job-mapper, drizzle-job-repository mutableColumns, job-dto — **mirror the
`callbackOf`/`scope` passthrough EXACTLY**, the 1B.1 template), `lib/store/dto-mapper.ts` + store Job
type (client threading); `modules/frontdesk/app/tools/book-visit.ts` (resolve + persist + gate),
`modules/frontdesk/infra/drizzle-availability-reader.ts` (reader gains skill_tags),
`modules/frontdesk/app/dispatch.ts` types (CrewLoad gains `skillTags`); tests.

**Interfaces — Produces:** `jobs.required_certs text[] NULL` (additive; jobs has RLS — no RLS
migration); `JobProps.requiredCerts: readonly string[] | null` passthrough; `jobDTO.requiredCerts:
z.array(z.string()).nullable()`; `CrewLoad` gains `readonly skillTags: readonly string[]`
(readSameDayCrewLoads selects `users.skill_tags`); in `assignCrew` (book-visit.ts:300-315):
`const required = resolveServiceRequirement(playbook.services, input.service_name)` →
`const qualified = candidates.filter(c => meetsRequirement(c.skillTags, required))` →
`chooseCrew({ candidates: qualified, jobPoint })` — **qualified empty → null (UNASSIGNED — the
existing null-assignee path; booking never blocked, unqualified tech never silently dispatched)**.
The booked job PERSISTS `requiredCerts: required` (resolved at create — `jobs.svc` is unreliable
post-hoc: free text on the AI path, literal `"service"`/`"estimate"` on manual, null from-estimate).
Manual/estimate create paths default `requiredCerts: null`.

- [ ] **Step 1: Failing unit tests** — dispatch harness: requirement filters to qualified-only
  before choose; none qualified → null; no requirement → identical to today; domain: requiredCerts
  passthrough (default null, preserved, read back).
- [ ] **Step 2: Schema + 0081 (verify live) → domain/mapper/repo/DTO/store threading → PASS.**
- [ ] **Step 3: Reader + book-visit wiring → harness PASS. Int test:** reader returns skillTags;
  a booked job persists the resolved requiredCerts.
- [ ] **Step 4: Commit** `feat(frontdesk): skill-gated auto-dispatch + job-inherited required certs`.

### Task 5: Office suggestion — job modal (banner + Crew-select annotation) + dead-code deletion

**Files:** Modify `components/modals/job-modal.tsx` — the banner lands at the EXACT
`{/* deferred: smartPanel skills-gap per-visit banner */}` comment (line ~251, under the conflict
banner); annotate/sort the VisitRow Crew `<select>` (lines ~214-225); DELETE the dead prototype
code (`SKILL_RULES` / `jobNeededSkill` / `techHasSkill` / `jobDayLoad`, lines ~523-560).

**Interfaces — Consumes:** store `job.requiredCerts` (T4), `Tech.skills` (T2), the pure gate (T1),
cross-job load via `dayLoad` (`features/jobs/jobs-helpers.ts:84`).

- [ ] **Step 1:** Banner (in-flow `div.banner`, only when `requiredCerts` non-empty): shows
  `Needs {certs}` + one of: `✓ {tech} is certified` (assigned & qualified) · `{tech} is missing
  {missing} — {suggestedName} is certified and lightest today` (assigned & unqualified; suggestion =
  qualified, least `dayLoad`) · `No tech on the team holds {missing}` (nobody qualifies). Functional
  copy, full ink.
- [ ] **Step 2:** Crew select: qualified techs listed first; unqualified options get a
  `— missing {certs}` suffix. Selection NEVER blocked.
- [ ] **Step 3:** Delete the dead prototype skill code. Unit-test any extracted pure helper
  (suggestion pick). Screenshot the banner in all three states.
- [ ] **Step 4: Commit** `feat(jobs): skill suggestion banner + crew-select annotation`.

### Task 6: Board annotation (suggest-only, additive-only) + screenshots

**Files:** Modify `features/jobs/schedule-panel.tsx` ONLY as annotation: while a visit is armed or
dragging (`placing`/drag state, lines ~74-76), IF its job has `requiredCerts`: (a) add a className
modifier to unqualified techs' lane-name blocks (`gv-row`/`gv-name`, lines ~199-210 — dim + a small
`missing {cert}` note next to the existing `Xh / 8h` load text); (b) append the suggested qualified
least-loaded tech to the existing armed-name banner (lines ~145-152). Plus `app/prototype.css` rules.

- [ ] **Step 1:** Thread `requiredCerts` through the board item derivation (the armed/dragged item
  must know its job's requirement — extend `boardItemsFor`/tray item shape minimally).
- [ ] **Step 2:** The two annotations. DROPS STAY ENABLED everywhere (suggest-only). No new panels,
  no popovers, no structural change to lanes/rows.
- [ ] **Step 3: Screenshot-verify** (dedicated PORT, owner@e2e creds): a job needing Gas armed on
  the board → unqualified lanes dimmed with the note, banner suggests the certified tech; the job
  modal banner states. Iterate to the forms-ui bar. **This task is small on purpose so the
  screenshots actually happen.**
- [ ] **Step 4: Commit** `feat(jobs): schedule board skill annotations (suggest-only)`.

**→ Full gate, then ONE PR: "Skill-aware dispatch — certified techs, per-service requirements".**

---

## Execution notes

- Branch `feat/skill-dispatch` off merged main (#108 in). One PR; Owen merges; verify the PR is
  still OPEN before any follow-up push.
- Review lenses per task: tenant scoping on every query; ALL cert comparisons through the pure gate
  (grep for stray `.toLowerCase()` cert compares); the zod round-trip (T3); the board diff is
  annotation-only (T6 — reject anything structural); no grey helper text; deleted dead code stays
  deleted.
- The AI-path fallback (qualified-empty → UNASSIGNED) is a deliberate behavior change to live
  bookings — it's stated in the PR body for Owen's eyes.

## Self-review (done)

- Design coverage: tags on techs (T2) ✓ per-service requirement (T3) ✓ inherit-at-create + persist
  (T4) ✓ AI gate + unassigned fallback (T4) ✓ office suggest-only surfaces (T5, T6) ✓ shared pure
  primitive (T1) ✓ dead-code deletion (T5) ✓ non-goals stated ✓.
- Type consistency: `skillTags` (users/DTO/CrewLoad) vs store `Tech.skills` (existing field name,
  deliberately reused); `requiredCerts` everywhere else; `meetsRequirement`/`missingCerts`/
  `resolveServiceRequirement` signatures identical across tasks. ✓
- No placeholders; every task names exact files + the verified line anchors from scoping. ✓
