# Jobs filter chips — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Jobs list's already-built filter chip row visible, split `Late` out of `This week`, and retire the Status column in favour of Address.

**Architecture:** Mostly exposure, not new build. `JobsViewFilter` and its server-side counts exist and render only behind a disclosure; this promotes them, deletes the Filters/Columns controls, adds one new SQL band (`late`), moves band identity from a Status pill into the WHEN cell's wording and tone, and writes the `.chip.on` / `.jh-filters` CSS that has never existed.

**Tech Stack:** Next 16 App Router · tRPC v11 · Drizzle/Postgres · Zustand · Vitest (unit + separate int config) · hand-rolled CSS in `app/prototype.css`.

**Spec:** `docs/superpowers/specs/2026-08-13-jobs-filter-chips-design.md`

## Global Constraints

- Branch `feat/jobs-filter-chips`, worktree `mallet-app-jobchips`. Owen merges; open a PR, never push to `main`.
- Style only with `--space/--type/--radius` tokens. `pnpm lint:css` FAILS on a raw px or hex.
- No floating UI. The chip row is anchored and in-flow.
- UI copy is functional, not chatty. Labels stay Owen's ("Needs a slot", not "Unscheduled").
- Coverage gate: 80% stmts / 75% branches. Do not regress.
- Full gate before PR: `pnpm tsc --noEmit · lint · lint:css · test · test:int · coverage · build`.
- Chip display order: `All · Needs a slot · Late · Today · This week · Upcoming · Done, not billed · Done`.
- Exclusivity order (different from display order, on purpose): `needsSlot → today → late → week → upcoming → needsInvoice → done → archived`.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `app/prototype.css` | The one styling system | Add `.jh-filters`, `.chip.on`, `.chip-n`, `.chip:disabled`; add `.jl-when.slot/.late/.unbilled`, `.jl-addr`; delete `.jst*` |
| `modules/jobs/infra/job-views.ts` | The SQL views + counts | Add `late`; `week` excludes it |
| `modules/jobs/api/job-views.int.test.ts` | Proves exclusivity against the live DB | New `late` cases |
| `features/jobs/today-derive.ts` | `BandKey` union | Add `"late"` |
| `features/jobs/server-rows.ts` | Server view → band, All-view per-row band | `BAND_FOR_VIEW.late`; `bandForJob` detects late |
| `features/jobs/job-row.ts` | Per-row display derivation | `WhenLabel` gains `tone`/`href`; `late` arm; **delete** `jobStatusView`/`StatusView` |
| `features/jobs/jobs-list-view.tsx` | The table | Status column out, Address in |
| `features/jobs/jobs-toolbar.tsx` | Toolbar | Drop Filters + Columns props |
| `features/jobs/jobs-home.tsx` | Orchestrator | Render chips unconditionally; delete disclosure + column state |
| `features/jobs/jobs-view-filter.tsx` | The chip row | Add `late`; drop the `Clear` link |
| `features/jobs/jobs-list-config.ts` | Static config | Shrinks to `JobsArchiveSet` |
| `features/jobs/jobs-columns.tsx` | Column picker | **Delete** |
| `lib/store/types.ts` | Store `Job` | Add `cust?: string` |
| `lib/store/dto-mapper.ts` | DTO → store | Map `cust` |
| `features/jobs/jobs-hydrator.tsx` | List DTO → store | Map `cust` |
| `features/jobs/jobs-helpers.ts` | `custName` | Drop the untyped cast |

---

### Task 1: The chip CSS that has never existed

Fixes the shipped Customers list in the same commit — `.chip.on` has no rule anywhere, so its
selected chip is currently identical to every unselected one.

**Files:**
- Modify: `app/prototype.css` (chips block ~line 1064)

**Interfaces:**
- Produces: `.jh-filters` row layout, `.chip.on` selected state, `.chip-n` count, `.chip:disabled`. Consumed by `jobs-view-filter.tsx`, `customers-group-filter.tsx`, `quotes-ledger.tsx`.

- [ ] **Step 1: Add the rules** beneath the existing `.chip.sel` rule.

```css
  /* The filter-chip row (Jobs, Customers, Quotes). ANCHORED AND IN-FLOW — not a popover.
     .on and .sel are different jobs and both stay: .sel marks a chosen option INSIDE a form
     (checklist stage, close-out mode, tip amount), where the chip row is the input; .on marks
     the ACTIVE FILTER over a list and sits in the same visual band as the Active/Archived
     segmented control, so it takes that control's ink fill — picking one of N is the same idea.
     Left as .sel's pale fill, one active chip in eight is told apart by a border alone. */
  .jh-filters{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center;margin-bottom:var(--space-4)}
  .chip.on{background:var(--ink);border-color:var(--ink);color:var(--card)}
  .chip:disabled{opacity:.5;cursor:default}
  .chip:disabled:hover{border-color:var(--line)}
  .chip-n{font-variant-numeric:tabular-nums;color:var(--ink-3);font-weight:600}
  .chip.on .chip-n{color:color-mix(in srgb,var(--card) 62%,transparent)}
```

- [ ] **Step 2: Verify the stylesheet lints**

Run: `pnpm lint:css`
Expected: PASS (0 errors). A raw px or hex here fails the gate.

- [ ] **Step 3: Commit**

```bash
git add app/prototype.css
git commit -m "fix(ui): the selected filter chip has a selected state

.chip.on has never had a rule. The components write .on; the stylesheet defines
.chip.sel, which four modal surfaces use for a different idea. So on the SHIPPED
Customers list the active chip is pixel-identical to the seven inactive ones, and
.jh-filters — also ruleless — holds its row on default inline-button spacing."
```

---

### Task 2: The `late` band, in SQL

**Files:**
- Modify: `modules/jobs/infra/job-views.ts`
- Test: `modules/jobs/api/job-views.int.test.ts`

**Interfaces:**
- Produces: `JOB_VIEWS` includes `"late"`; `JOB_VIEW_LABELS.late === "Late"`; `viewCondition("late", tx, {today})`.
- Consumes: existing `OUTSTANDING`, `visitWhere`, `ViewParams`.

- [ ] **Step 1: Write the failing integration tests**

Follow the file's existing seeding helpers. Four cases, because a new arm means exclusivity
must be re-proven rather than assumed:

```ts
describe("late — a placed visit that is past due and still open", () => {
  it("counts a job whose only outstanding visit is dated before today", async () => {
    // seed: visit dated today-3, assigned, status scheduled
    // expect: counts.late === 1, counts.week === 0
  });

  it("files a job with BOTH an overdue visit and one today under today, not late", async () => {
    // The dispatcher's day view has to contain everything going out today.
    // expect: counts.today === 1, counts.late === 0
  });

  it("does not call an overdue visit late once it is complete", async () => {
    // A finished visit is history — OUTSTANDING excludes it.
    // expect: counts.late === 0
  });

  it("leaves a past-dated visit with NO crew in needsSlot, not late", async () => {
    // PLACED requires a day AND an assignee; no lane for nobody.
    // expect: counts.needsSlot === 1, counts.late === 0
  });

  it("keeps the seven active counts summing to the active book", async () => {
    // needsSlot + late + today + week + upcoming + needsInvoice + done === activeOnly total
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test:int modules/jobs/api/job-views.int.test.ts`
Expected: FAIL — `"late"` is not an accepted view.

- [ ] **Step 3: Implement**

Add `lt` to the drizzle import. Then:

```ts
export const JOB_VIEWS = ["needsSlot", "late", "today", "week", "upcoming", "needsInvoice", "done", "archived"] as const;

export const JOB_VIEW_LABELS: Record<JobView, string> = {
  needsSlot: "Needs a slot",
  late: "Late",
  today: "Today",
  // …unchanged
};
```

Inside `viewCondition`, alongside `onToday` / `byWeekEnd`:

```ts
  // Overdue: a trip that was booked onto a past day and has not happened. It used to fall into
  // `week` (byWeekEnd has no lower bound, so every past date satisfied it) — deliberately, with a
  // comment saying moving it was a product decision. This is that decision: late work is the most
  // actionable state on the screen and it was scattered through a 34-row band.
  const onLate = visitWhere(tx, and(OUTSTANDING, lt(jobVisits.scheduledDate, p.today)) as SQL);
```

```ts
    case "late":
      // TODAY OUTRANKS LATE. A job carrying an overdue trip AND one today belongs on today's run —
      // a day view that omits work going out today is not a day view. The overdue trip is still
      // named on the row (see jobWhenLabel).
      return and(open, onLate, sql`NOT ${onToday}`) as SQL;
    case "week":
      // Anything due on or before today+7 that is neither today's nor overdue. `byWeekEnd` has no
      // lower bound, so without the late exclusion the same job satisfies both and the counts stop
      // summing to the book.
      return and(open, byWeekEnd, sql`NOT ${onToday}`, sql`NOT ${onLate}`) as SQL;
```

`needsSlot` and `upcoming` are untouched: `needsSlot` is `NOT EXISTS(OUTSTANDING)` and a late job has
one by definition; `upcoming` already requires `NOT byWeekEnd`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test:int modules/jobs/api/job-views.int.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add modules/jobs/infra/job-views.ts modules/jobs/api/job-views.int.test.ts
git commit -m "feat(jobs): Late is its own band, split out of This week"
```

---

### Task 3: Client band plumbing

**Files:**
- Modify: `features/jobs/today-derive.ts` (`BandKey`)
- Modify: `features/jobs/server-rows.ts` (`BAND_FOR_VIEW`, `bandForJob`)
- Test: `features/jobs/server-rows.test.ts`

**Interfaces:**
- Consumes: `JobView` from Task 2.
- Produces: `BandKey` includes `"late"`; `bandForJob(job)` returns `"late"` for a job with an outstanding past-dated visit. Consumed by Tasks 4–5.

- [ ] **Step 1: Write the failing test**

```ts
describe("bandForJob — the All view's only source of band identity", () => {
  it("returns late for an open job whose placed visit is dated before today", () => {
    const job = mkJob({ status: "scheduled", visits: [
      { date: daysAgo(3), techId: "t1", start: 480, status: "scheduled" },
    ]});
    expect(bandForJob(job)).toBe("late");
  });

  it("prefers today over late when the job has both", () => {
    const job = mkJob({ status: "scheduled", visits: [
      { date: daysAgo(3), techId: "t1", start: 480, status: "scheduled" },
      { date: todayISO(),  techId: "t1", start: 540, status: "scheduled" },
    ]});
    expect(bandForJob(job)).toBe("today");
  });

  it("does not call a past visit late once it is done", () => {
    const job = mkJob({ status: "scheduled", visits: [
      { date: daysAgo(3), techId: "t1", start: 480, status: "done" },
    ]});
    expect(bandForJob(job)).not.toBe("late");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test features/jobs/server-rows.test.ts`
Expected: FAIL — `bandForJob` returns `"later"`.

- [ ] **Step 3: Implement**

`today-derive.ts`:

```ts
export type BandKey = "needsSlot" | "late" | "today" | "thisWeek" | "later" | "doneUnbilled" | "done" | "archived";
```

`server-rows.ts`:

```ts
const BAND_FOR_VIEW: Record<JobView, BandKey> = {
  needsSlot: "needsSlot",
  late: "late",
  today: "today",
  // …unchanged
};
```

```ts
/**
 * With no view selected the list is mixed, so the band key is derived per row from the job's own
 * state. Display hint only — the row still renders its real date.
 *
 * The late arm is the first one whose derivation can visibly DISAGREE with the server's SQL (it
 * shows as a rust date instead of a plain one), so it mirrors viewCondition's rule exactly: an
 * outstanding visit — dated, crewed, not complete, not canceled — landing before today, and today
 * winning when the job has both.
 */
const bandForJob = (job: Job): BandKey => {
  if (job.status === "done") return "done";
  if (job.status === "unscheduled") return "needsSlot";
  const today = todayISO();
  const outstanding = (job.visits ?? []).filter(
    (v) => v.date && v.techId != null && v.status !== "done" && v.status !== "canceled",
  );
  if (outstanding.some((v) => v.date === today)) return "today";
  if (outstanding.some((v) => (v.date ?? "") < today)) return "late";
  return "later";
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test features/jobs/server-rows.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add features/jobs/today-derive.ts features/jobs/server-rows.ts features/jobs/server-rows.test.ts
git commit -m "feat(jobs): the client band plumbing carries Late"
```

---

### Task 4: The WHEN cell takes over from the Status pill

**Files:**
- Modify: `features/jobs/job-row.ts`
- Test: `features/jobs/job-row.test.ts`

**Interfaces:**
- Consumes: `BandKey` from Task 3.
- Produces: `WhenLabel { label, live, onsiteAt?, tone?: "amber" | "rust", href?: string }`. **Removes** `jobStatusView` and `StatusView` — one consumer (`jobs-list-view.tsx`, Task 5).

- [ ] **Step 1: Rewrite the test around WHEN**

Delete the `jobStatusView` describe block. Add:

```ts
describe("jobWhenLabel — the cell carries the band now the Status column is gone", () => {
  it("names how late an overdue job is, in rust", () => {
    const j = mkJob({ visits: [{ date: daysAgo(3), techId: "t1", start: 480, status: "scheduled" }] });
    const w = jobWhenLabel("late", j, 0);
    expect(w.label).toBe("3d late · Aug 10");
    expect(w.tone).toBe("rust");
  });

  it("amber is rationed to the three money-leak states", () => {
    expect(jobWhenLabel("needsSlot", mkJob(), 4).tone).toBe("amber");
    expect(jobWhenLabel("doneUnbilled", doneJob, 0).tone).toBe("amber");
    expect(jobWhenLabel("today", onsiteJob, 0).live).toBe(true);
    expect(jobWhenLabel("thisWeek", mkJob(), 0).tone).toBeUndefined();
    expect(jobWhenLabel("done", doneJob, 0).tone).toBeUndefined();
  });

  it("only needsSlot links out — it goes where the row click does not", () => {
    expect(jobWhenLabel("needsSlot", mkJob(), 4).href).toBe("/jobs?tab=schedule");
    expect(jobWhenLabel("doneUnbilled", doneJob, 0).href).toBeUndefined();
    expect(jobWhenLabel("late", lateJob, 0).href).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test features/jobs/job-row.test.ts`
Expected: FAIL — `tone`/`href` do not exist; `"late"` is not handled.

- [ ] **Step 3: Implement**

```ts
/**
 * The right-hand "when" text — and, since the Status column was retired, the row's BAND too.
 *
 * The Status pill printed the active chip's own word on every row (twenty rows reading "Today"),
 * so it was deleted and its two remaining jobs moved here: the tone that rations amber to the
 * money-leak states, and the one link that goes somewhere the row click does not.
 */
export interface WhenLabel {
  label: string;
  live: boolean;
  onsiteAt?: string;
  /** amber = money on the floor (needs a slot, done-unbilled). rust = overdue, the aging rail's far end. */
  tone?: "amber" | "rust";
  /** Only needsSlot. Everything else's action IS the job modal, which clicking the row opens. */
  href?: string;
}
```

`soldWhen` returns `{ …, tone: "amber", href: "/jobs?tab=schedule" }` on both arms.

New arm:

```ts
function lateWhen(job: Job): WhenLabel {
  const v = jobNextVisit(job);
  const d = v?.date ?? "";
  const days = Math.max(1, daysBetween(d, todayISO()));
  return { label: `${days}d late · ${whenDateLabel(d, todayISO())}`, live: false, tone: "rust" };
}
```

```ts
export function jobWhenLabel(bandKey: BandKey, job: Job, leadAge: number): WhenLabel {
  switch (bandKey) {
    case "needsSlot": return soldWhen(job, leadAge);
    case "late":      return lateWhen(job);
    case "today":     return todayWhen(job);
    case "doneUnbilled": return { ...doneWhen(job), tone: "amber" };
    case "done":
    case "archived":  return doneWhen(job);
    default:          return scheduledWhen(job);
  }
}
```

Delete `StatusView` and `jobStatusView` entirely.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test features/jobs/job-row.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add features/jobs/job-row.ts features/jobs/job-row.test.ts
git commit -m "feat(jobs): the WHEN cell carries the band, and the Status pill is deleted"
```

---

### Task 5: Status column out, Address in

**Files:**
- Modify: `features/jobs/jobs-list-view.tsx`
- Modify: `app/prototype.css` (WHEN tones + `.jl-addr`; delete `.jst*`)
- Test: `features/jobs/jobs-list-view.test.tsx`

**Interfaces:**
- Consumes: `WhenLabel` from Task 4; `Job.addr` (already on the store, mapped at `dto-mapper.ts:418`).
- Produces: a fixed five-column table — Customer/Job · When · Address · Crew · Amount.

- [ ] **Step 1: Write the failing test**

```ts
it("has no Status column", () => {
  render(<JobsListView {...props} />);
  expect(screen.queryByRole("columnheader", { name: /status/i })).toBeNull();
});

it("shows the job address", () => {
  render(<JobsListView {...propsWith({ addr: "418 Cedar St" })} />);
  expect(screen.getByText("418 Cedar St")).toBeInTheDocument();
});

it("links a needs-a-slot WHEN cell to the board without opening the row", async () => {
  const onOpenJob = vi.fn();
  render(<JobsListView {...slotProps} onOpenJob={onOpenJob} />);
  await userEvent.click(screen.getByRole("link", { name: /sold/i }));
  expect(onOpenJob).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test features/jobs/jobs-list-view.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement**

Drop `visibleCols` / `JobColKey` / `RowCell`'s switch. `ListRow` swaps `status: StatusView` for
`addr: string`. Fixed colgroup and header:

```tsx
<colgroup>
  <col />
  <col style={{ width: 150 }} />{/* when */}
  <col style={{ width: 190 }} />{/* address */}
  <col style={{ width: 130 }} />{/* crew */}
  <col style={{ width: 104 }} />{/* amount */}
</colgroup>
```

```tsx
<SortTh label="Customer / Job" col="customer" sort={sort} onActivate={clickCol} />
<SortTh label="When" col="when" sort={sort} onActivate={clickCol} />
{/* Address has no server sort, and a header that does nothing is a dead control. */}
<th>Address</th>
<th>Crew</th>
<SortTh label="Amount" col="amount" sort={sort} onActivate={clickCol} right />
```

The WHEN cell renders its tone, and wraps in a `<Link>` when `href` is set — stopping propagation so
it does not also open the row:

```tsx
const cls = `jl-when${row.when.live ? " live" : ""}${row.when.tone === "rust" ? " late" : ""}${
  row.when.tone === "amber" ? (row.when.href ? " slot" : " unbilled") : ""}`;
```

CSS, inside the `.jh-wrap` scope so the tones can reach `--jrust`:

```css
  .jl-when.slot{color:var(--jamber);font-weight:700;text-decoration:underline;
    text-decoration-color:color-mix(in srgb,var(--jamber) 35%,transparent);text-underline-offset:3px}
  .jl-when.slot:hover{text-decoration-color:var(--jamber)}
  .jl-when.late{color:var(--jrust);font-weight:700}
  .jl-when.unbilled{color:var(--jamber);font-weight:700}
  .jl-addr{font-size:var(--type-base);color:var(--jink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
```

Delete the now-unused `.jst`, `.jst .d`, `.jst-amber`, `.jst-neutral` rules.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test features/jobs/jobs-list-view.test.tsx && pnpm lint:css`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add features/jobs/jobs-list-view.tsx features/jobs/jobs-list-view.test.tsx app/prototype.css
git commit -m "feat(jobs): the Status column gives way to Address

Status derived the pill from the row's band, and the band is the view, so under
the default filter the column printed \"Today\" twenty times. The address is the
one fact that differs on every row."
```

---

### Task 6: Promote the chip row; delete Filters and Columns

**Files:**
- Modify: `features/jobs/jobs-home.tsx`, `features/jobs/jobs-toolbar.tsx`, `features/jobs/jobs-view-filter.tsx`, `features/jobs/jobs-list-config.ts`
- Delete: `features/jobs/jobs-columns.tsx`
- Test: `features/jobs/jobs-home.test.tsx`

**Interfaces:**
- Consumes: `JOB_VIEWS` (Task 2), the five-column table (Task 5), `.jh-filters`/`.chip.on` (Task 1).
- Produces: `JobsToolbar` without `filtersOpen`/`onToggleFilters`/`colsOpen`/`onToggleCols`/`activeFilterCount`.

- [ ] **Step 1: Write the failing test**

```ts
it("shows the filter chips without opening anything", () => {
  render(<JobsHome {...props} />);
  expect(screen.getByRole("group", { name: /filter jobs/i })).toBeVisible();
  expect(screen.getByRole("button", { name: /needs a slot/i })).toBeVisible();
  expect(screen.getByRole("button", { name: /^late/i })).toBeVisible();
});

it("has no Filters or Columns button", () => {
  render(<JobsHome {...props} />);
  expect(screen.queryByRole("button", { name: /^filters/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /^columns/i })).toBeNull();
});

it("marks the active view's chip pressed, so the default filter is visible", () => {
  render(<JobsHome {...props} />);
  expect(screen.getByRole("button", { name: /today/i })).toHaveAttribute("aria-pressed", "true");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test features/jobs/jobs-home.test.tsx`
Expected: FAIL — the chips are behind the disclosure.

- [ ] **Step 3: Implement**

`jobs-home.tsx` — delete `filtersOpen`, `colsOpen`, `visibleCols`, `toggleCol`, `activeFilterCount`,
the `JobsColumns` import and render, and the `DEFAULT_JOB_COLS`/`JOB_COL_ORDER`/`JobColKey` imports.
Render the filter unconditionally:

```tsx
{/* The one filter. Chips, not a panel: the list DEFAULTS to view="today", so behind a disclosure
    the screen arrived filtered with nothing naming the filter — and reported "20 of 20" on a
    1,500-job book. Same slot and same component shape as the Customers list. */}
<JobsViewFilter
  view={q.view}
  counts={list.counts?.counts}
  onView={q.setView}
  disabled={archiveSet === "archived"}
/>
```

`jobs-toolbar.tsx` — drop the five props and both buttons. `keep` the Active/Archived toggle, the
search, and the `{shown} of {total}` readout.

`jobs-view-filter.tsx` — drop `onClear` and the `Clear` link (with the row visible, `All` IS the
clear); `SELECTABLE` keeps excluding `archived`, which the toggle owns.

`jobs-list-config.ts` — delete `JobColKey`, `JOB_COLS`, `JOB_COL_ORDER`, `DEFAULT_JOB_COLS`,
`JobStatusFilter` and `JOB_STATUS_FILTERS` (the last two were already dead — declared, never
imported). The file keeps only `JobsArchiveSet`.

`clearFilters()` stays in `jobs-home.tsx` for the empty-state link.

Delete `features/jobs/jobs-columns.tsx`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test features/jobs && pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A features/jobs
git commit -m "feat(jobs): the filter chips come out of the disclosure

The list defaults to view=today, so the screen arrived filtered with nothing on it
naming the filter — the only tell was an amber 1 on a collapsed button — while the
toolbar read \"20 of 20\" on a book of ~1,500 jobs. Columns goes with it: four
load-bearing columns is not a set worth hiding."
```

---

### Task 7: The `—` customer names

The server already resolves `customerName` on `jobSummaryDTO`, with a docstring describing this exact
bug. Both client mappers drop it.

**Files:**
- Modify: `lib/store/types.ts`, `lib/store/dto-mapper.ts`, `features/jobs/jobs-hydrator.tsx`, `features/jobs/jobs-helpers.ts`
- Test: `lib/store/dto-mapper.test.ts`, `features/jobs/jobs-hydrator.test.ts`

**Interfaces:**
- Consumes: `jobSummaryDTO.customerName` (exists).
- Produces: `Job.cust?: string`, populated on both read paths.

- [ ] **Step 1: Write the failing tests**

```ts
it("keeps the server-resolved customer name on the job", () => {
  const job = dtoJobToStoreJob(mkJobDTO({ customerName: "Ruth Whitaker" }));
  expect(job.cust).toBe("Ruth Whitaker");
});

it("resolves a name for a job whose lead is past the leads hydrator's page", () => {
  const job = { ...mkStoreJob({ leadId: "not-loaded" }), cust: "Ruth Whitaker" };
  expect(custName(job, [])).toBe("Ruth Whitaker");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test lib/store/dto-mapper.test.ts features/jobs`
Expected: FAIL — `cust` is undefined, `custName` returns `"—"`.

- [ ] **Step 3: Implement**

`lib/store/types.ts`, on `Job`:

```ts
  /**
   * The customer's name as the SERVER resolved it for this row.
   *
   * The list joins jobs against the store's `leads` collection, and leads hit the same page
   * ceiling jobs do — so any job whose lead sat past that page rendered "—". The wire has carried
   * the name all along (jobSummaryDTO.customerName); both mappers dropped it.
   */
  cust?: string;
```

`dtoJobToStoreJob` and the hydrator's `toStoreJob`, in the returned object:

```ts
    cust: dto.customerName ?? "",
```

`jobs-helpers.ts` — the chain is already right; only the cast comes off:

```ts
export function custName(j: Job, leads: Lead[]): string {
  // Store-lead FIRST on purpose: a customer renamed in the office updates the store immediately,
  // while `cust` is a per-read snapshot that is stale until the next refetch. The wire value is
  // the fallback that fires for every lead past the leads hydrator's page.
  const lead = leads.find((l) => l.id === j.leadId);
  return lead?.name ?? j.cust ?? "—";
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test lib/store features/jobs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/store/types.ts lib/store/dto-mapper.ts features/jobs/jobs-hydrator.tsx features/jobs/jobs-helpers.ts lib/store/dto-mapper.test.ts
git commit -m "fix(jobs): the customer name the server already sent stops being dropped"
```

---

### Task 8: Gate and PR

- [ ] **Step 1: Full gate**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm lint:css && pnpm test && pnpm test:int && pnpm coverage && pnpm build`
Expected: all PASS, coverage ≥ 80% stmts / 75% branches.

- [ ] **Step 2: Re-baseline the visual net deliberately**

Run: `E2E_VISUAL=1 pnpm e2e` for `/jobs` and `/customers`.
`/customers` moves because Task 1 fixes a shipped screen. Inspect each diff before accepting —
never a blind `--update`.

- [ ] **Step 3: Open the PR**

Body states: the chip row was already built and hidden; `Late` changes where overdue work is
counted (`week`'s number drops by whatever `late` takes); `.chip.on` fixes Customers too.
