# Server-side lists — getting to Jobber-grade data presentation

## The problem, stated precisely

`lib/store/hydrator-config.ts` says it out loud:

```ts
/** 500 = pilot ceiling; cursor iteration is needed for any org beyond this. */
export const HYDRATOR_PAGE_LIMIT = 500;
```

Seventeen hydrators fetch one page of 500 rows into a Zustand store at app start. Sixty call
sites then read whole collections out of that store and filter, sort and search them in the
browser.

Measured on the seeded shop right now: **1,521 jobs in the database, 500 in the app.** The Jobs
list then filters those 500 down and reports "220 of 220" — truthful about the browser, silently
wrong about the business.

**A 20-job/day shop crosses 500 jobs in 25 working days.** The failure mode is the dangerous kind:
nothing errors, the counts just quietly stop matching reality.

## What already exists (this is smaller than it looks)

- **Keyset pagination is built and correct.** `shared/db/keyset.ts` has `keysetBefore` /
  `keysetAfter`, with the postgres.js Date-in-tuple bug already solved. `buildPage`,
  `decodeCursor` and `toPage` are shared.
- **Cursor inputs already exist** on `leads.list`, `companies.list`, `invoices.list`,
  `jobs.list`, `checklists.list`.
- **Indexes exist** for the default ordering: `org_created_idx` on jobs/leads/invoices/estimates,
  `org_status_due_idx` on invoices, `org_assignee_date_idx` and `org_date_idx` on job_visits.

**So the server can already paginate. What it cannot do is sort, search or filter on demand** —
every repository hardcodes `ORDER BY created_at DESC`, and `search` exists only in pricebook.

## The split that keeps this tractable

Not every collection needs this. Divide by whether the collection is **bounded by the shop's
size** or **grows with time**:

| Bounded — keep in the store | Unbounded — must go server-side |
|---|---|
| techs, settings, brand, a2p | **jobs** |
| checklist templates, pricebook | **leads / customers** |
| | **invoices** |
| | **estimates** |
| | **timesheets** |

A shop has 6 technicians forever. It does not have 6 jobs forever. **Five collections, not
seventeen.**

---

## Phase 1 — Server: sort, search, filter (additive, ships alone)

Nothing breaks; existing callers keep their defaults.

**1.1 A shared list-query contract.** One input shape reused by all five:

```ts
{ cursor?, limit?, sortBy?, sortDir?, search?, filters? }
```

`sortBy` must be a **z.enum of named sorts**, never a raw column name. A client-supplied column
is an injection surface and it welds the API to the schema. Each named sort maps to an ORDER BY
and an index inside the repository.

**1.2 The named sorts, chosen to match how the work actually runs:**

| List | Default | Also offered |
|---|---|---|
| Jobs | `scheduled` — upcoming soonest-first, history most-recent-first | created, customer, amount, status |
| Customers | `lastActivity` | name, created, ~~value~~ |
| Invoices | `oldestUnpaid` — collection order | due, amount, created, status, ledger |
| Estimates | `created` | sent, status, ~~amount~~ |
| Timesheets | `date` | tech, ~~week~~ |

**Three struck through, each for a reason worth keeping:**

- **Customers `value`** — 606 customers, none with a stored value, and 20 relevant estimates.
  Sorting by a column nobody populates orders the list arbitrarily while looking authoritative.
  Jobber does not show it either.
- **Estimates `amount`** — an estimate has no total column; the figure is lines → rounding →
  discount in basis points → tax, computed in the domain. Sorting by it in SQL means writing that
  chain a second time in a second language, and the two will drift. Needs a cached `total_cents`
  maintained on write, the way `invoices.total_cents` already is — a schema change, not a sort.
- **Timesheets `week`** — a week is a RANGE, already expressed as `fromDate`/`toDate` and already
  what the office panel sends. A sort named "week" would order rows identically to `date` while
  implying otherwise.

Jobs defaulting to scheduled date rather than created date is the single biggest perceived
difference from Jobber. A dispatcher thinks in *when the work happens*, never *when the row was
written*.

**1.3 Search** — `ILIKE` across name, phone, email, address, job title and number. Server-side, so
it finds the customer from three years ago that was never in memory.

**1.4 Filters** — status, assignee, date range, unscheduled. Server-side so a filtered count is
the *real* count.

**Test:** every new sort gets an integration test asserting order across a page boundary. Sort
bugs hide on page one and surface on page two, which is exactly where nobody looks.

## Phase 2 — Indexes (must land with Phase 1, not after)

An unindexed sort is a sequential scan over the whole tenant. At 1,500 jobs nobody notices; at
40,000 the page times out.

- `jobs`: `(org_id, scheduled_start DESC)`, `(org_id, status, scheduled_start)`
- `job_visits`: `(org_id, scheduled_date, assignee_user_id)` — exists, verify it covers the board
- `leads`: `(org_id, updated_at DESC)` for last-activity
- `invoices`: `(org_id, status, due_at)` — exists as `org_status_due_idx`
- **Search:** `pg_trgm` GIN indexes on the searched text columns. Without trigram, `ILIKE '%x%'`
  cannot use an index at all.

Single-writer migration rule applies — one branch, generated then hand-checked, RLS unaffected
(policies cover rows, not columns).

**Verify with `EXPLAIN ANALYZE` against the seeded org, not by assertion.** An index that is not
actually chosen by the planner is worse than none, because it looks like the problem is solved.

## Phase 3 — Client: one screen at a time

The order matters — worst offender first, and each ships independently.

1. **Jobs** (`jobs-list-view.tsx`, `jobs-home.tsx`) — the one you demoed
2. **Customers** (`app/(office)/customers`)
3. **Money / invoices** (`money-ledger.tsx`)
4. **Estimates / pipeline**
5. **Timesheets**

**Per screen:** replace `useAppStore((s) => s.jobs)` with a `useInfiniteQuery` owned by that
screen. Delete its hydrator once nothing else reads that collection. Server returns the true
total so the header reads "220 of 1,521" rather than "220 of 220".

### The hard part, named up front

**Optimistic updates currently work because the whole collection is local.** `jobs-slice.ts`
mutates the store, fires the mutation, and reconciles or rolls back. With server-paginated data
the optimistic edit has to apply to a *page* that may not contain the row any more — a job
rescheduled out of "today" belongs on a different page entirely.

This is the part that will take the longest and it is where the bugs will be. The approach:
mutate the tRPC query cache for the visible page, and invalidate rather than patch when the
mutation changes a field the current sort or filter depends on. There is precedent in the
codebase — `_recentLineWrites` already guards a stale-hydrator window — but it needs to become
the normal path rather than a special case.

**Done — `lib/trpc/list-cache.ts`.** It was right that this was where the bug would be: the screens
were converted first and this was left, so for a while a save reached the database and the list on
screen did not move until the window was refocused.

Resolved by INVALIDATING, never patching. Patching the cached page would have to reimplement every
sort and filter in the browser to know whether an edited row still belongs on the page it is on —
an edit can move a row to a page that is not loaded (a job rescheduled out of "today", an invoice
paid off out of "overdue"). Refetching asks the database, which is the thing that knows.

The mutations live in Zustand slices, which are not components and cannot call `useUtils()`, so the
provider registers the QueryClient into a module the slices can reach. Sixteen call sites, each
inside the `.then` of a mutation — never alongside the optimistic write, because a refetch that
overtakes the commit renders the row back to its old value. Job writes invalidate the invoice lists
too: Money's top half is "finished work nobody has billed", which is a jobs query.

## Phase 4 — Scoped default views

The deeper fix, and cheap once Phase 1 lands. Stop opening "all jobs".

- **Jobs** → Today · This week · Unscheduled · Needs invoicing · All
- **Customers** → Recent · Owes money · No job in 12 months · All
- **Money** → Overdue · Sent · Draft · Paid
- **Schedule** → already day/week scoped; just needs its query paginated

Each is a filter preset over Phase 1's parameters, so it is UI work, not new backend.

"All" stays available and stops being the front door.

---

## Sequencing

| | Work | Ships alone? |
|---|---|---|
| 1 | Server sort/search/filter | Yes — nothing consumes it yet |
| 2 | Indexes + EXPLAIN verification | With 1 |
| 3a | Jobs screen | Yes |
| 3b | Customers | Yes |
| 3c | Money, estimates, timesheets | Yes, each |
| 4 | Scoped views | Yes, per screen |

Phases 1 and 2 are safe and invisible. Every Phase 3 screen is independently shippable and
independently revertible.

## How we know it worked

- Jobs list on the seeded org reads **"n of 1,521"**, not 220 of 220
- Searching a customer created 90 days ago finds them
- `EXPLAIN ANALYZE` shows index scans, not seq scans, for every default sort
- Sidebar counts equal `SELECT count(*)`, not the page size
- Board and lists stay responsive with 40,000 jobs — seed to that number and measure

### Measured, 2026-07-30 — `scripts/scale-benchmark.mjs`

40,000 jobs · 8,000 customers · 12,000 invoices · 20,000 time entries, in a throwaway org, with
EXPLAIN ANALYZE on the query shapes the repositories actually emit. **Nothing over 100 ms.**

| Query | | |
|---|---|---|
| jobs · default sort (scheduled) | 0.4 ms | index |
| jobs · sort by created | 0.1 ms | index |
| jobs · sort by amount | 0.3 ms | index |
| jobs · sort by customer (join leads) | 4.9 ms | index |
| jobs · search, selective term | 18–36 ms | index (`jobs_title_trgm_idx`, `jobs_num_trgm_idx`) |
| jobs · search matching 20% of the table | 90.8 ms | seq scan — **correct** at that selectivity |
| jobs · count for the header | 11.7 ms | seq scan |
| board · one week of visits | 2.6 ms | index |
| customers · default sort | 0.1 ms | index |
| customers · search, selective term | 10.6 ms | seq scan (8k rows — scan wins) |
| customers · worklist "owes money" | 9.8 ms | seq scan |
| invoices · ledger order | 11.2 ms | seq scan |
| invoices · collection order | 0.1 ms | index |
| timesheets · one week | 0.6 ms | index |

**What it caught.** The jobs search had no trigram index — Phase 2 specified them for "the searched
text columns" and only leads got them. It was the slowest thing in the application and the only one
near a user-visible delay. Fixed in `0116_job_search_trgm`.

**The remaining sequential scans are the right plan, not debt:**

- *20%-selectivity search* — reading the table beats hopping an index for one row in five. The
  planner is correct; this row exists to know the ceiling.
- *count for the header* — counting 40,000 rows means visiting them.
- *ledger order* — the rank is a CASE over `now()`, and `now()` is STABLE rather than IMMUTABLE, so
  it cannot be an expression index. Inherent to ranking by "is it overdue *right now*".
- *customers search / owes money* — 8k leads and 12k invoices are small enough that a scan wins;
  the trigram and FK indexes are there for when they are not.

**A finding outside the lists.** `jobs.callback_of` is a self-referencing FK with no index behind
it, so deleting a job re-checks the whole jobs table. Deleting 40,000 in one statement exceeded the
statement timeout. Harmless for a shop deleting one job at a time, and the benchmark batches around
it — but it is why bulk cleanup there is slow, and worth an index if bulk delete ever matters.

## Out of scope, deliberately

- Saved/custom views per user
- Bulk actions across a filtered set
- CSV export (needs its own streaming path, not a big page)
