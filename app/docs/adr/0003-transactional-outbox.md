# ADR 0003: Transactional outbox (write side)

- **Status:** Accepted (write side; relay + scheduler follow)
- **Date:** 2026-07-01
- **Context:** Domain events (`invoice.paid`, `customer.created`, reminder triggers…) are emitted by use-cases through the `EventBus` port. Until now the binding was an in-memory bus: events were dropped on process exit and never delivered to anything. Phase 2's durability goal needs post-commit side effects (SMS/email, later accounting sync) that (a) fire only if the state change committed, (b) are never lost on a crash, and (c) don't roll the business transaction back when a downstream provider is slow or down.

## Decision

### 1. Write events to an `outbox` table in the same transaction as the state change

`OutboxEventBus` implements the `EventBus` port and `INSERT`s each emitted event into an `outbox` row using the **caller's tenant transaction**. So the event and the state change commit atomically: a rolled-back operation emits nothing, and a committed operation always leaves a durable event row. Columns: `org_id`, `event_name`, `payload` (jsonb), `occurred_at`, `created_at`, `published_at` (null until delivered), `attempts`, `last_error`.

The bus is bound to the request transaction at the composition layer, not injected as a singleton:

- **tRPC:** the `orgTx` middleware constructs `new OutboxEventBus(tx, orgId)` and overrides `ctx.deps.bus` for the request, so every use-case's `emit` lands in the outbox within that request's tx.
- **Stripe webhook:** the route constructs an `OutboxEventBus(tx, orgId)` inside its `withTenant` block, so `invoice.paid` / `invoice.payment.recorded` are durable too.

The in-memory bus remains the default in `AppDeps` (and in unit tests, which drive use-cases directly).

### 2. RLS on the write path; the relay is the single sanctioned non-RLS read path

The `outbox` table has ENABLE + FORCE RLS with a `FOR ALL` policy `org_id = current_org_id()`. So a write is tenant-scoped exactly like every other table — and an event stamped with a **foreign org id is rejected** by the `WITH CHECK`, rolling the whole tx back (fail-closed; verified by test).

The background relay (next slice) is a **trusted system process, not a tenant request**, so it reads unpublished rows via the **BYPASSRLS owner connection** (the same one migrations use) — the single sanctioned non-RLS data path at runtime. Crucially, it does **not** do tenant work under that connection: for each row it re-enters `withTenant(row.org_id)` and dispatches the handler under RLS, so the actual side effect is still tenant-scoped. (Chosen over strict per-org polling, which would need an org-enumeration mechanism and be slower, for no real isolation gain — the claim query reads only the outbox, and dispatch re-scopes.)

### 3. Payload is stored as jsonb; `occurred_at` is a real column

`event.payload` is stored as `jsonb` (Dates serialize to ISO strings — handlers re-parse). `occurred_at` is a dedicated `timestamptz` so the relay/consumers can order and reason about event time without decoding the payload.

## Review hardening (2026-07-01)

The slice's adversarial review confirmed five findings (all LOW / latent). Fixed the two that are cheap now and painful to retrofit later; the third is deferred to the relay slice, where it is properly solved:

- **No recoverable intra-tx order (fixed):** `created_at` defaults to `now()` = `transaction_timestamp()`, which is **constant within a transaction**, and the PK is a random UUID — so two events emitted in one tx (e.g. `invoice.payment.recorded` then `invoice.paid`) had no persisted total order for the relay to sort by. Added a `seq bigserial` column (a sequence advances once per row, even inside a tx) and pointed the unpublished-poll index at it, so the relay orders by `seq`. A migration can't recover an order that was never recorded, so this had to be fixed on the write side. (Regression test asserts strictly increasing `seq` for same-tx emits.)
- **Payload not JSON-safe (fixed):** the payload is stored via drizzle's bare `JSON.stringify` (not superjson), so a `Date` round-trips lossily, a `BigInt` throws (rolling back the business tx), and `undefined` keys vanish silently. No current emitter hits this (dates are pre-serialized), but the port type was `Record<string, unknown>`. Tightened `DomainEvent.payload` to a JSON-safe `Record<string, JsonValue>` so an accidental `Date`/`undefined` is a **compile error at the emit site**, not a lossy row at read time.
- **Emit after an irreversible external send (deferred):** `SendNotificationUseCase` does the real Resend/Twilio send, then `markSent`, then `emit` — all in one tx. The outbox `INSERT` adds one more in-tx failure point after the send, so a transient DB error could roll back a message that was already delivered. This is **pre-existing** (`markSent` is already a post-send in-tx write) and the correct fix is the deferred **true-outbox shape**: the tx only claims the idempotency key and writes a `notification.requested` event; the **relay performs the send after commit** and stamps sent/failed by id. Tracked for the relay slice — not hacked now, since reordering emit-before-send isn't clearly better.

## Amendment (2026-08-20, see ADR 0008)

§2's "single sanctioned non-RLS path" was widened by one table: `agent_tasks` (the AI employee's durable task queue) is now the **second** table the BYPASSRLS owner connection may touch, via one narrow claim statement (`modules/agent-tasks/infra/claim-due-tasks.ts`) that is restricted to queue-bookkeeping columns only (`id`, `org_id`, `status`, `deleted_at`, `next_action_at`, `locked_until`, `lease_id`, `attempts`) and never reads the task's `title` or its transcript (`agent_task_messages`) — that content is read only inside `withTenant`, under ordinary RLS, once the org id is known. ADR 0008 also records why that claim needed a lease where the outbox's claim deliberately has none.

## Consequences

- Events are now **durably captured** atomically with their state change across the whole tRPC surface and the Stripe webhook. Every mutation writes its events to the DB instead of an in-memory buffer (verified: the full integration suite still passes, and a `customers.create` call lands a `customer.created` outbox row).
- **Deferred (the next slice):** the **relay + scheduler** — a worker (Vercel Cron route to start, Inngest later) that claims unpublished rows via the owner connection, dispatches each under `withTenant(org_id)` to registered handlers (e.g. "on `invoice.sent` → send the invoice notification"), stamps `published_at`, and records `attempts`/`last_error` (a **safe discriminator only**, never provider PII/free text — per ADR 0002). Ordering, at-least-once delivery, and a poison-row cap belong there.
- **Dependency to honor before the relay ships:** the SMS path has no per-message idempotency key (ADR 0002), so a durable per-message dedupe token must land before the relay re-drives failed SMS rows, or it will double-send.
- `attempts` / `last_error` are provisioned on the table now (they're relay bookkeeping) so the relay slice needs no schema migration.
