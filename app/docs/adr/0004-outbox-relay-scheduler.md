# ADR 0004: Outbox relay + scheduler

- **Status:** Accepted (relay engine + cron trigger; auto-notify handlers deferred)
- **Date:** 2026-07-01
- **Context:** ADR 0003 made event capture durable (events land in the `outbox` in the same tx as the state change). This ADR turns durable *capture* into durable *delivery*: a background relay that drains unpublished rows and dispatches each to a handler, marks it published, retries transient failures, and caps poison rows — triggerable by cron. Design chosen from three independent architect proposals + a synthesis pass.

## Decision

### 1. CLAIM (owner conn) → DISPATCH (withTenant) → MARK — three separate transactions, at-least-once

`runOutboxRelay(handlers, opts)` runs one bounded tick:

- **CLAIM** — one statement on a dedicated **owner (BYPASSRLS) connection** (`shared/db/owner-client.ts`, the *only* runtime use of `DATABASE_URL` outside migrations — the single sanctioned non-RLS read path per ADR 0003): select the oldest unpublished rows under their poison budget, `ORDER BY seq` (the monotonic key — `created_at` is tx-constant), `LIMIT batch`, `FOR UPDATE SKIP LOCKED`, and **increment `attempts` in the same statement**. Incrementing at claim time means a handler that crashes the whole process still burns an attempt, so a poison row can't loop forever.
- **DISPATCH** — for each claimed row, re-enter `withTenant(row.org_id)` (least-privilege `mallet_app`, RLS) and call the registered handler. The handler's DB work is tenant-scoped exactly like a request; the relay does **no** tenant work on the owner connection. No handler for the event → drain as a no-op (mark published).
- **MARK** — on the owner connection, per row: ok → `published_at = now()`; retryable failure → leave unpublished for the next tick.

These three phases are **separate transactions**, so delivery is **at-least-once** and **handlers MUST be idempotent**. (Holding one tx across the network dispatch — to get exactly-once — is the anti-pattern we explicitly avoid: it would pin a connection for the whole slow dispatch.)

### 2. Handler disposition rule (safe retry, no attempt-spinning)

A handler returns `Result<void, AppError>`:

- **ok** → published.
- **err, `external_service` + `retryable`** → left unpublished; the next tick retries (attempts already incremented).
- **any other err** (validation / not_found / conflict — a bad or un-processable event) → **published** (terminal), recording a safe reason. Retrying would fail identically, so we stop re-claiming.
- **thrown** → left unpublished for retry, `last_error = "unhandled"`.

`last_error` is a **safe, low-cardinality discriminator only** (`safeLastError`): the `AppError.kind`, or `external_service:<service>`, or `"unhandled"` — **never** the provider's free text, recipient, or body (ADR 0002's PII rule). Unit-tested to drop PII.

### 3. Poison cap

The claim's `WHERE attempts < maxAttempts` (default 8) excludes rows that burned their budget. A poison row stays unpublished with `last_error` set — a **visible dead-letter** (queryable), not silently dropped and not looping.

### 4. Concurrency is at-least-once, not exactly-once

`FOR UPDATE SKIP LOCKED` prevents two claims from grabbing the same row **while it is locked** — but the claim statement auto-commits (releasing the lock) *before* the network dispatch, so an overlapping tick (a tick slower than the cron interval) can re-claim a not-yet-published row and dispatch it again. This is **safe because handlers are idempotent** — the documented contract. The integration test asserts the real guarantee: under concurrent ticks **no row is lost or stuck and there is no deadlock** (every row ends published; each is dispatched ≥1 time). A lease / `pg_advisory_lock` single-flight guard to approach exactly-once is a **deferred** optimization; at pilot cron cadence (every 5 min) with fast ticks, overlap does not occur in practice.

### 5. Trigger: a CRON_SECRET-guarded route

`app/api/cron/outbox/route.ts` (GET + POST; Vercel Cron invokes the scheduled path with a **GET** carrying `Authorization: Bearer <CRON_SECRET>`). Auth is **fail-closed**: `CRON_SECRET` unset → `503` (never runs unauthenticated); missing/mismatched → `401` (constant-time compare over SHA-256 digests; the presented value is never logged). Returns the `RelaySummary` (counts only — no per-row PII). `vercel.json` schedules `*/5 * * * *` (note: Vercel Hobby allows only daily cron — the pilot needs Pro, a coarser schedule, or an external pinger hitting the route with the bearer secret).

### 6. Handlers registered in the pilot: exactly one, internal, no external side effect

`trpc/outbox-registry.ts` is the explicit allow-list. It registers **only** `invoice.paid → InvoicePaidAuditHandler`: an internal, idempotent handler that re-reads the invoice under RLS (proving withTenant dispatch scopes to the right org) and returns ok. There is no projection to fill (invoice.paid is emitted *after* `applyPayment` already set `status='paid'`); it exists to exercise the full relay path end-to-end with **zero external call and zero double-send risk**. Every other event drains as a no-op.

**No notification / auto-notify handler is registered — this slice changes NO customer-facing behavior.**

## Deferred (and why)

- **Auto-notify handlers** (`invoice.sent → email/text the customer`, `invoice.paid → receipt`): each is a **product-behavior change** — today notifications are a manual office action (`SendInvoiceUseCase` only flips draft→sent + emits; the UI separately calls `SendInvoiceNotificationUseCase`). Registering an `invoice.sent` handler makes every "Send" click auto-message the customer. **Pending the human's sign-off** (see open questions), and gated on:
  - a **deterministic idempotency key** (`outbox:invoice_sent:<invoiceId>`) so relay re-dispatch dedupes at the notification ledger — AND **unifying** the manual UI key (currently `manual:<id>:<uuid>`) to the same value, or a manual send + an auto send would be **two** messages to the customer.
  - for **SMS**, a durable **per-message dedupe token** (Twilio has no idempotency key; a timeout can leave delivered-but-marked-failed — ADR 0002). Email (Resend) is provider-idempotent, so auto-email could ship first.
- **True-outbox notification reshape** (the request only queues + emits `notification.requested`; the relay performs the send after commit and stamps sent/failed by id): the correct home for relay-owned send retry + the SMS dedupe token; a multi-file change, deferred.
- **Lease / single-flight** (near-exactly-once under overlapping ticks), **Inngest** migration (event-driven concurrency/backoff/dead-letter/replay — the handler registry + disposition contracts port over unchanged), **dead-letter admin surface**, **backoff/jitter between retries**, **published-row archival**, **fan-out** (1 event → N handlers).

## Review hardening (2026-07-01)

The slice's adversarial review confirmed 9 findings (mostly overlapping). Fixed:

- **`attempts` now increments on failure, not at claim (HIGH/MED — #1, #2, #4):** originally the claim statement burned an attempt for every claimed row, so a row that was **claimed but never dispatched** — a tick truncated by the function timeout, or a mark-write failure that aborted the batch tail — could reach the poison cap **without ever being delivered**. Now the claim is a plain `SELECT … FOR UPDATE SKIP LOCKED` and only `recordFailure` (a real dispatch failure/throw) increments `attempts`. A never-dispatched row keeps `attempts = 0` and stays re-claimable, so it can never become a never-delivered dead-letter. (A process-crash-loop guard — for a handler that repeatedly kills the process before `recordFailure` — is the deferred lease model; the pilot's only handler is an idempotent read.)
- **Per-row guard so a mark-write blip can't strand the batch (HIGH — #1, #8):** the whole per-row body is wrapped in a try/catch that logs a distinct `markErrors` and continues, so an owner-conn drop / statement timeout on one row's mark no longer propagates out of the loop and abandons every remaining already-claimed row.
- **Mark separated from dispatch classification (MED — #3, #9):** the success-path `markPublished` no longer runs inside the dispatch `try`, so a mark failure after a successful handler is not misattributed as a handler throw (`last_error="unhandled"`, counted `failed`). The disposition is decided (pure `dispositionFor`), then the mark runs under the outer per-row guard.
- **Counters gated on affected-row count (LOW — #7):** `markPublished`/`recordFailure` return the affected count; under a concurrent race where the `published_at IS NULL` guard no-ops (a peer tick already published), the outcome is counted `raced` instead of over-counting `published`/`failed`, so `RelaySummary` reflects true per-tick outcomes.
- **Empty-string `CRON_SECRET` no longer 500s the whole app (MED — #5):** `z.preprocess("" → undefined)` so a blank Vercel env var degrades to the intended fail-closed 503 at the cron boundary instead of failing config validation at boot (which `shared/db/client.ts`'s top-level `loadConfig` turns into an app-wide 500).
- **`maxDuration = 60` on the route (MED — #4, defense-in-depth):** gives a tick room to finish (honored on Pro); not a correctness dependency now that a truncated tick doesn't poison.
- **Accepted as-designed:** a *malformed* (too-short, non-empty) `CRON_SECRET` fails fast at boot (#6) — the documented config contract; the empty-string fix covers the realistic misconfig. Exactly-once under overlapping ticks stays deferred (lease model) — the contract is at-least-once + idempotent handlers.

The pure decision logic (`dispositionFor`, `safeLastError`) is unit-tested; the DB-orchestration (`relay.ts`, `owner-client.ts`, the audit handler) is integration-tested (and excluded from the unit-coverage threshold like the repos).

## Consequences

- The relay is a durable, correct, observable delivery mechanism that ships with **no customer-facing behavior change** — turning on auto-notify is a separate, reviewed, one-handler change.
- First runtime use of the owner connection; confined to `owner-client.ts` + the relay, which touch only the outbox table.
- `CRON_SECRET` is optional (app boots without it; the route 503s). It's in gitignored `.env.local` for the pilot; set a strong value as a Vercel env var in prod.
