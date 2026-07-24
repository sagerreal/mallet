# QuickBooks Online sync — build plan

Research + decisions: `prospecting/research/2026-07-24-timesheets-quickbooks-sync.md` (sibling repo
folder). Read that first — it holds the API facts, the tier analysis, and the risks.

## Goal

One-way push of **approved** Mallet time entries into QuickBooks Online as `TimeActivity` records,
so shops stop retyping hours into QuickBooks before payroll.

Explicitly **not** in scope: pulling anything back, two-way sync, invoicing from time, customer
sync, or the premium Time API.

## Why this is four PRs, not one

There is no QuickBooks integration in the codebase today — the `Connect QuickBooks` button in
`features/money/money-ledger.tsx` has an empty handler. Most of the work is the connection itself
(per-tenant OAuth + encrypted tokens + refresh-with-rotation); the `TimeActivity` push is small
once that exists.

---

## PR 1 — connection layer (this branch)

Ships with **nothing syncing**. Just: a shop can connect and disconnect QuickBooks.

- `platform/crypto/secret-box.ts` — AES-256-GCM seal/open, DI-constructed from a key. New
  primitive: nothing in the repo encrypts-and-recovers today (`api_keys` only stores a SHA-256
  *hash*, which is one-way and doesn't work for OAuth tokens we must replay).
- `shared/db/schema/qbo-connections.ts` + migration `0086` + hand-written RLS `0087`
  (drizzle-kit does not emit RLS — see CLAUDE.md).
- `modules/qbo/domain/` — `QboConnection` value object; the token-rotation invariants live here.
- `modules/qbo/infra/drizzle-qbo-connection-repository.ts`
- `modules/qbo/infra/intuit-oauth-gateway.ts` — token exchange + refresh, through
  `platform/resilience/resilient-call.ts`.
- `app/api/qbo/authorize` + `app/api/qbo/callback` routes (CSRF `state`, org-scoped).
- Settings card: connect / status / disconnect.

**The one thing most likely to break in production:** Intuit rotates the refresh token every
24–26h. Miss one write-back and the tenant is locked out. Every exchange MUST persist the returned
refresh token, and concurrent refreshes MUST be serialised (row lock) or two in-flight requests
race and one wins with a dead token.

## PR 2 — preflight + mapping

- Read `Preferences.TimeTrackingPrefs` at connect time; if `TimeTrackingEnabled` is false or the
  company is on QBO Simple Start, say so plainly and stop. Named precondition, not a mystery 400.
- `qbo_entity_links` (generic: `entity_type` ∈ employee | service_item | customer) so invoices and
  customers can reuse it later without a migration.
- Crew-matching screen (explicit id mapping — **not** name matching; Jobber's name-matching is
  their top support burden).
- Default service item picker, seeded from `TimeTrackingPrefs.DefaultTimeItem`.
- Connect-time read of the trailing 2–4 weeks of `TimeActivity`: if the company already has time
  in it, warn rather than silently double-posting.

## PR 3 — the sync

- `approve-week.ts` takes an `EventBus` and emits `timeEntry.weekApproved` (today those use-cases
  emit nothing — the `logger.info(..., "timeEntry.created")` calls are log lines, not events).
- `QboTimeSyncHandler` registered in `trpc/outbox-registry.ts`.
- `qbo_sync_log` with a unique key on `(org_id, 'time_entry', mallet_id)` — **the outbox is
  at-least-once by design**, so idempotency must be enforced in the DB. Duplicated payroll hours is
  a money bug at a customer's business.
- Batch via the `/batch` endpoint (≤30 entities/request).
- Sync log UI + per-item retry.
- A more frequent cron, or drain-on-approve — today `vercel.json` runs the outbox relay once daily
  (`0 9 * * *`), so "I approved the week and nothing happened" would be the default for ~24h.

## PR 4 — cleanup

Wire or delete the dead `Connect QuickBooks` button; update `docs/stub-punchlist.md`.

---

## Mapping (decided)

| Mallet | QBO `TimeActivity` |
|---|---|
| mapped user | `EmployeeRef` (or `VendorRef` for 1099) + `NameOf` |
| org default service item | `ItemRef` — **required by QBO on every create** |
| `work_date` | `TxnDate` |
| `hours()` → `Hours` + `Minutes` | **not** `StartTime`/`EndTime` — avoids the timezone/offset trap |
| `note` | `Description` |
| `kind = job` → billable | `BillableStatus` |
| — | `HourlyRate` / `CostRate` / `PayrollItemRef` **omitted** — payroll owns the wage |
| 40h overtime split | **not sent** — QBO Payroll computes OT itself; sending pre-split double-counts |

`CustomerRef` omitted in v1: it needs customer sync, and a bad ref fails the whole entry.

## Open

Base-tier payroll pickup is ~75% confirmed (per-employee `UseTimeEntry` flag, not a tier gate), with
unresolved smoke in Intuit's help content about base payroll + the built-in weekly timesheet. Closes
for free with one question to a pilot shop — see the research doc. Does not block PR 1.
