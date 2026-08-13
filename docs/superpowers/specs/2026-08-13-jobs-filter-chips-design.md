# Jobs list — the filter chip row

**Status:** approved by Owen, 2026-08-13
**Branch:** `feat/jobs-filter-chips`
**Mockup:** https://claude.ai/code/artifact/5066f2ed-cfb3-4249-9fbf-daa10b410774

## Problem

The Jobs list hides its own filter and lies about its size.

`useJobsQueryState` defaults `view` to `"today"` (Owen, Aug 11 — a dispatcher opens Jobs to run the
day). The chip row that would show which view is active lives behind the `Filters` disclosure and
renders only when `filtersOpen` is true. So the screen arrives filtered, with nothing on it naming
the filter — the only tell is an amber `1` on a collapsed button — and the toolbar reports
"20 of 20" on a book of roughly 1,500 jobs. Both numbers are true of the slice; neither reads that
way.

Three smaller failures ride along:

- **The STATUS column restates the filter.** `jobStatusView` derives the pill from the row's band,
  and the band is the view, so under the default the column prints "Today" twenty times. Same
  disease the Customers list just cured by dropping `stage` — a column with one value in it cannot
  be scanned and cannot be filtered by.
- **Overdue work has no category.** `job-views.ts` files a placed visit dated in the past under
  `week`, deliberately and with a comment saying moving it is a product decision. It is now that
  decision: late work is the single most actionable state on the screen and it is scattered through
  a 34-row band.
- **Customer names render as `—`.** `custName()` joins server-paged jobs against the client store's
  `leads` collection; any job whose lead sits past the leads hydrator's page never resolves.

## What already exists

Most of the machinery is built and unreachable.

| Piece | State |
|---|---|
| `features/jobs/jobs-view-filter.tsx` | Complete, with per-view server counts. Rendered only when `filtersOpen`. |
| `modules/jobs/infra/job-views.ts` | Six mutually-exclusive views + `archived`, counted in one round trip. |
| `jobSummaryDTO.customerName` | Already resolved server-side, with a docstring describing this exact bug. |
| `Job.addr` | On the domain, the DTO and the store; mapped at `dto-mapper.ts:418`. |

So this is mostly an exposure change, not a build. The two genuinely new pieces are the `late` band
and the CSS the chip row has never had.

**Correction to an earlier read of this bug:** the `—` names are not a missing server field. The
server resolves `customerName` and both client mappers — `dtoJobToStoreJob` (`lib/store/dto-mapper.ts`)
and `toStoreJob` (`features/jobs/jobs-hydrator.tsx`) — drop it on the floor. The fix is client-side
and small. The invoices ledger already solved the identical problem the right way
(`cust: dto.customerName ?? priorInv.cust`); Jobs follows it.

## Design

### 1. The chip row comes out of the disclosure

`JobsViewFilter` renders unconditionally between the toolbar and the list — the slot Customers uses,
so the two lists sit at the same rhythm.

Deleted with it:

- The **Filters** button, `filtersOpen`, and `activeFilterCount`. The row IS the indicator; a count
  pill on a button that opens the row it counts is a second, worse copy of the same fact.
- The **Columns ▾** button, `JobsColumns`, `colsOpen`, `visibleCols`, `toggleCol`, and the
  `JobColKey` / `JOB_COLS` / `JOB_COL_ORDER` / `DEFAULT_JOB_COLS` config. Four load-bearing columns
  remain; there is nothing worth hiding. Same call Customers made.
- `JOB_STATUS_FILTERS` and `JobStatusFilter` in `jobs-list-config.ts` — dead already, declared and
  never imported. `jobs-list-config.ts` shrinks to `JobsArchiveSet`.
- `JobsViewFilter`'s **Clear** link. With the row visible, `All` is the clear. `clearFilters()` stays
  for the empty-state link, which is where a dead-end actually needs an exit.

`archiveSet === "archived"` keeps disabling the chips rather than hiding them — the row stays put so
nothing below it jumps.

### 2. The `late` band

Added to `JOB_VIEWS` and `JOB_VIEW_LABELS`:

```
late  →  "Late"
```

Predicate: open, with an OUTSTANDING visit dated before today, and nothing outstanding today.

```ts
case "late":
  return and(open, onLate, sql`NOT ${onToday}`) as SQL;
```

where `onLate = visitWhere(tx, and(OUTSTANDING, lt(jobVisits.scheduledDate, p.today)))`.

`week` must now exclude it — `byWeekEnd` is `lte(scheduledDate, weekEnd)` with no lower bound, so it
swallows every past date:

```ts
case "week":
  return and(open, byWeekEnd, sql`NOT ${onToday}`, sql`NOT ${lateCond}`) as SQL;
```

**Today outranks Late.** A job carrying both an overdue visit and one today belongs on today's run —
the dispatcher's day view has to contain everything going out today or it is not a day view. The
overdue trip is still visible on the row (see §3).

`needsSlot` needs no change: it is `NOT EXISTS(OUTSTANDING)`, and a late job has one by definition.
`upcoming` needs no change: it already requires `NOT byWeekEnd`.

**Display order is not predicate order,** and the file must say so. Chips read
`All · Needs a slot · Late · Today · This week · Upcoming · Done, not billed · Done` — the two stuck
states lead, the time run stays contiguous because a dispatcher scans it as a sequence, and the
billing exception sits beside Done where finished work is looked for. Exclusivity is resolved
`needsSlot → today → late → week → upcoming → needsInvoice → done → archived`.

Client-side twins to follow it:

- `BandKey` (`today-derive.ts`) gains `"late"`.
- `BAND_FOR_VIEW` (`server-rows.ts`) gains `late: "late"`.
- `bandForJob` — the per-row hint used when no view is selected — must detect late from the job's own
  visits, not just `job.status`. This is the All view's only source of band identity.

### 3. STATUS out, ADDRESS in — the band moves into WHEN

The Status column is deleted, along with `jobStatusView`, `StatusView` and their tests.
`jobStatusView` has exactly one consumer (`jobs-list-view.tsx`), so nothing is left half-used.

The band vocabulary does change to match the chips — it has to, or the chip says Late while the row
says Scheduled. It lands in the WHEN cell, which already carried the date and can carry both:

| Band | WHEN reads | Tone |
|---|---|---|
| Needs a slot | `sold 4d ago →` / `Fri · 8a · no crew →` | amber, links to the Schedule board |
| Late | `3d late · Aug 10` | rust |
| On site | `● on site · 9:12a` | amber, pulsing dot |
| Today | `Today · 12p` | — |
| This week | `Thu · 8a` | — |
| Upcoming | `Aug 24 · 8a` | — |
| Done, not billed | `done Aug 12` | amber |
| Done | `done Aug 8` | — |

`WhenLabel` grows `tone?: "amber" | "rust"` and `href?: string`; `jobWhenLabel` gains a `late` arm.

Two deliberate calls:

- **Amber stays rationed** to the three money-leak states the ledger palette already reserves it for
  (needs a slot, on site, done-unbilled). Late takes `--jrust`, the far end of the existing
  sand→amber→rust aging rail — no new token, and it reads hotter than amber, which is correct for the
  only band that is already costing you the customer.
- **Only `needsSlot` gets the arrow.** It goes somewhere the row click does not — the Schedule board.
  A done-unbilled row's action is the job modal, which is what clicking the row already does, so an
  arrow there would promise a second destination that does not exist. (The mockup showed one on
  done-unbilled; dropped on review.)

The freed column takes **Address**, from `job.addr` — already mapped, no query change. Same swap
Customers made when it dropped `Latest`: the one fact that differs on every row, and what people in
the trades actually recall a job by.

Sorting is unaffected: `SORT_COL_TO_SERVER` never had a `status` entry, and Address gets none — a
header that does nothing is a dead control, so Address renders as a plain `<th>`.

### 4. The CSS the chip row has never had

`.jh-filters` and `.chip.on` have no rule anywhere in `app/prototype.css`. The component writes
`.on`; the stylesheet defines `.chip.sel`. So the selected chip on the Customers list — shipped and
live — is visually identical to every unselected chip, and the row holds its shape on default inline
button spacing.

```css
.jh-filters{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center;margin-bottom:var(--space-4)}
.chip.on{background:var(--ink);border-color:var(--ink);color:var(--card)}
.chip:disabled{opacity:.5;cursor:default}
.chip:disabled:hover{border-color:var(--line)}
.chip-n{font-variant-numeric:tabular-nums;color:var(--ink-3);font-weight:600}
.chip.on .chip-n{color:color-mix(in srgb,var(--card) 62%,transparent)}
```

Plus the WHEN tones and the address cell, inside the `.jh-wrap` scope so they reach `--jrust`:

```css
.jl-when.slot{color:var(--jamber);font-weight:700;text-decoration:underline;
  text-decoration-color:color-mix(in srgb,var(--jamber) 35%,transparent);text-underline-offset:3px}
.jl-when.slot:hover{text-decoration-color:var(--jamber)}
.jl-when.late{color:var(--jrust);font-weight:700}
.jl-when.unbilled{color:var(--jamber);font-weight:700}
.jl-addr{font-size:var(--type-base);color:var(--jink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
```

**`.chip.on` and `.chip.sel` are different jobs and both stay.** `.sel` marks a chosen option inside a
form — checklist stage, close-out mode, tip amount, four surfaces — where the chip row is the input.
`.on` marks the active filter over a list, sits in the same visual band as the Active/Archived
segmented control, and takes that control's ink fill because picking one of N is the same idea. Left
as `.sel`'s pale fill, one active chip in eight would be told apart by a border alone. Do not
"unify" these later.

Fixing `.chip.on` fixes the Customers list in the same commit. `quotes-ledger.tsx` also uses
`.jh-filters` and gets the row layout for free; its chips use their own class and are unaffected.

### 5. The `—` customer names

Client-side only:

- `Job` (`lib/store/types.ts`) gains `cust?: string`.
- `dtoJobToStoreJob` and `toStoreJob` both map `cust: dto.customerName ?? ""`.
- `custName()` needs no logic change. Its chain is already `store lead → j.cust → "—"`; the second
  link has simply never been populated. Only the `as { cust?: string }` cast comes off, now that the
  field is typed.

The order stays store-first on purpose: a customer renamed in the office updates the store
immediately, while the job row's `cust` is a per-read snapshot that is stale until the next refetch.
The wire value is the fallback that fires for every lead past the leads hydrator's page — which is
the whole bug.

## Not changing

- The Schedule board. Separate surface, untouched.
- The Active/Archived toggle, the search field, the header and its `$ scheduled today` figure.
- Where the day figure comes from — it is the day's booked money and stays constant across chips.
- Overdue work's *sort* position. Only its band changes.
- Jobber's vocabulary. The labels stay Owen's.

## Testing

- **`job-views.int.test.ts`** — the load-bearing one. A `late` arm means the exclusivity property has
  to be re-proven, not assumed: seed a job with an overdue outstanding visit, one with both an
  overdue and a today visit (asserts Today wins), one overdue-but-complete (asserts it is not late),
  and one dated in the past with no crew (asserts it stays in `needsSlot`, not `late`). Assert the
  seven active counts still sum to the active book.
- **`job-row.test.ts`** — rewritten around `jobWhenLabel`'s tones and href now that `jobStatusView`
  is gone. Amber on exactly three bands, rust on late, href on `needsSlot` only.
- **`jobs-list-view.test.tsx`** — no Status column, Address renders `job.addr`, the needsSlot WHEN
  cell is a link that does not bubble the row click.
- **`jobs-home` tests** — chips visible without opening anything; no Filters or Columns button.
- **dto-mapper / hydrator** — `customerName` survives into `cust` on both paths.
- Visual net re-baselined for `/jobs` and `/customers` (the chip fix moves Customers' pixels too).
- Full gate before the PR: `tsc · lint · lint:css · unit · int · coverage · build`.

## Risks

- **Re-baselining Customers.** The `.chip.on` fix changes a shipped screen. Intended, but the visual
  net diff will show it and needs a deliberate re-baseline, not a blind `--update`.
- **`late` count drift.** `week`'s count drops by whatever `late` takes. Anyone reading the two
  numbers against a remembered total will see a change; that is the point, but it is worth saying in
  the PR body.
- **`bandForJob` fidelity.** The All view's client-side band hint can disagree with the server's SQL
  if the two rules drift. It is a display hint only — the row still renders its real date — but the
  late arm is the first one where a disagreement would be visible as a wrong colour.
