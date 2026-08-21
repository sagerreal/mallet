# ADR 0008: Durable agent tasks + a leased, scheduler-driven runner

- **Status:** Accepted
- **Date:** 2026-08-20
- **Context:** every agent surface Mallet has shipped so far (`modules/ai`'s in-process loop, the ADR 0006 MCP server, the ADR 0007 confirm flow) is **request-scoped** — it exists for the lifetime of one HTTP call, driven by a human or host who is watching. An AI *employee*, by contrast, needs to hold work that outlives the request that created it: "text the customer back when they reply," "follow up in three days if the quote isn't accepted," "check the crew's calendar every morning." None of that survives a closed laptop unless the work itself is a durable, server-owned row and something wakes it up without a human in the loop. Design validated against ADR 0003/0004's outbox + relay precedent, which already solved a structurally similar problem for events.

## Decision

### 1. A durable `agent_tasks` table + `runAgentTaskTick`, not a longer-lived request

`modules/agent-tasks` adds `agent_tasks` (RLS-scoped, one row per unit of work: `title`, `status`, `created_by`/`created_by_role` snapshot, `next_action_at`, lease fields, attempt/step counters) and `agent_task_messages` (the per-task transcript). A scheduler POSTs `app/api/cron/agent-runner/route.ts`; each invocation runs one bounded **tick** (`runAgentTaskTick`): claim due tasks across every org, re-enter each org's own tenant transaction, drive the existing agent loop (`runAgentTurn`) for a small, fixed number of iterations, and write back a disposition — `scheduled` (asked to be woken again), `finished`, `needs_you`, `backed_off` (transient LLM failure), or `raced` (lost a version race to a concurrent writer). A truncated tick is safe: the lease expires and the next tick re-claims the row, and the tool executor's execution ledger (same shape the confirm flow already relies on) means a wake killed mid-turn never repeats a committed side effect.

### 2. Amendment to ADR 0003 §2: `agent_tasks` is the second, still-narrow exception to RLS

ADR 0003 §2 named the BYPASSRLS **owner connection** the single sanctioned non-RLS runtime path, and scoped it to the outbox relay's own bookkeeping. This ADR widens that by exactly one table. `modules/agent-tasks/infra/claim-due-tasks.ts` is now the **only other** caller of the owner connection in the codebase, and the rule a reviewer can mechanically check is:

> The owner connection may read and write `agent_tasks` only through the columns `id, org_id, status, deleted_at, next_action_at, locked_until, lease_id, attempts` — via one atomic `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` — and must never read `title` or anything in `agent_task_messages`.

(This list has one more column than the plan's original text — `deleted_at` — because the claim's `WHERE` clause filters on it to skip soft-deleted rows; verified against the shipped statement, not assumed from the plan.)

Verified true of the code as shipped: the statement's `SET` list is `lease_id, locked_until`; its `WHERE` reads `status, deleted_at, next_action_at, locked_until`; its `RETURNING` is `id, org_id, attempts`. No `title`, no join to `agent_task_messages`, no `SELECT *`. The task body — `title`, the transcript, everything an attacker-adjacent or merely-private tenant might care about — is read exactly once the org id is known, inside `withTenant(orgId)`, by `DrizzleAgentTaskRepository`, under ordinary RLS. The owner connection never sees it. Everything else the runner needs (the creator's current role, the transcript, the task row for writing) also goes through `withTenant`, not the owner connection — `claimDueTasks` is the *only* cross-tenant statement in the module, by construction (`AgentTaskRepository` is built from an already-org-scoped tx and has no method that could express "every org").

### 3. Why a lease, when ADR 0004 §4 deliberately left the outbox without one

The outbox relay's claim also uses `FOR UPDATE SKIP LOCKED` with no lease, and ADR 0004 §4 accepted that two overlapping ticks can both dispatch the same row — because outbox handlers are a **documented idempotent contract**. An agent wake is not: a turn can send a text message or create a payment link, and a duplicate wake sends the customer a second message, which is not something a retry policy can undo after the fact. So `claimDueTasks` stamps `lease_id` + `locked_until` in the same statement that claims the row, and every later write to that row (`save`, `releaseLease`) carries the lease id as a fencing token — a worker whose lease already expired can never win a write race against whoever reclaimed the row. This is a real behavioral fork from the outbox precedent, made for the reason the outbox's own ADR named as the boundary of its own safety argument.

What live-DB testing actually surfaced while building this: the claim statement had to be wrapped in `ownerDb.transaction(...)`, not for atomicity (a lone statement is already atomic) and not for the lease semantics above, but because `ownerQueryClient` is a **pooled** client (`max: 2`), and the first statement(s) issued against a freshly constructed pooled connection could — non-deterministically — return a `RETURNING` set larger than the statement's own `LIMIT`, even with `LIMIT` inlined as a literal. Reproduced with `max: 2`, not reproduced at `max: 1`, not reproduced once the statement was pinned to one connection via an explicit transaction. **Removing the wrap as a "simplification" silently reopens a batch-cap violation** — no error, no exception, just more leased rows than `batch` asked for, discovered only by counting.

### 4. Why approvals do not persist across a wake boundary

ADR 0007's confirm flow already solved "propose, then execute only the frozen args against re-checked state" for a request-scoped caller. A background task's `needs_you` disposition does not need a second version of that machinery: the turn simply stops, and when a human later approves from **inside the app**, that approval runs synchronously against freshly re-read state in the same request — there is no frozen-args snapshot to drift, no fingerprint to re-check, no token to expire or be replayed, because nothing crossed a wake boundary. This isn't a deferral of the hard problem; it's a design that has no instance of it, for exactly the class of approval Phase 1 supports. **Trigger for revisiting:** the moment someone can approve from *outside* the app — an SMS or email reply — is the moment an approval genuinely does cross a wake boundary, and ADR 0007's frozen-args + fingerprint + TTL + single-consumption model (with `mcp-confirm.ts` as the working template, though its 3-minute TTL is too short for this use) becomes the right thing to port in, not re-derive.

### 5. Why the actor is the task's creator, never a sentinel id

`payments.recorded_by_user_id` has no FK, deliberately — the ledger has to survive a staffer leaving without orphaning historical records. That same looseness means a sentinel "system" user id would not fail loudly if used here: it would silently write a fake human actor onto a money row, indistinguishable at query time from a real one. So the runner re-reads the task's creator (`users` row, by id and org) inside the tenant transaction on **every** wake, and refuses to run — handing the task to a human instead — if that person is gone or their role no longer matches the snapshot the task was filed under. The principal driving every tool call is always a real, currently-valid user, never a placeholder.

## Deferred, with trigger conditions

Carried from the implementation plan's deferral table (`docs/superpowers/plans/2026-08-20-ai-employee-artie.md`):

| Deferred | Build it when |
|---|---|
| **Routines** (recurring tasks) | A shop schedules the same task text a second time. Needs local wall-clock fields + a snapshotted `tz` (never UTC time-of-day — DST breaks a naive schedule) and a firing key on the local occurrence. |
| **Triggers** (event-driven task creation) | A named event already exists and its `trpc/outbox-registry.ts` handler slot is free (the map silently replaces on collision — fan-out needs a composite handler first). |
| **Taught memory** (`agent_memory`) | A shop corrects the agent on the same fact twice. Must ride a fresh per-wake user message, never the cached `system` prompt or the empty-transcript-only `contextPreamble`. |
| **Durable approvals** (approve from outside the app) | Someone must approve by SMS or email reply — see §4 above. |
| **Transcript compaction** | The first real task trips `MAX_TRANSCRIPT_BYTES`. Must compact whole tool-use/tool-result turn pairs together, never split one. |
| **Per-org token budget** | Someone files enough tasks that the batch cap stops being the effective budget. Needs `AgentResult.usage` persisted per wake first — nothing persists usage anywhere in the repo today. |
| **Task-scoped capability freeze** (`allowed_tools`, `subject_ids`) | The first trigger-origin task ships — a task with no human author and attacker-influenced instruction text needs its tool catalog frozen at creation, not derived from a role. |
| **A "blocked" state** | Someone can define it as distinct from `needs_you` in a way a person could actually explain. |
| **Delimiting tool results on interactive surfaces** | After this runner's delimiters (`delimitResults: true`) have proven harmless in production — the in-app assistant's own integration tests currently assert on undecorated result text. |
| **Streaming** | Any time — unrelated to this plan, but the largest perceived-speed win still on the table. |

## Consequences

- The owner (BYPASSRLS) connection now has exactly two sanctioned callers — the outbox relay and `claimDueTasks` — both narrow, both auditable by grep, both returning ids/status columns only, never tenant content.
- The scheduler cadence is an operational decision, not a code decision: `vercel.json`'s `*/5 * * * *` entry requires a Vercel plan that permits sub-daily cron, and `TICK_CADENCE_MINUTES` (`modules/agent-tasks/app/agent-task-config.ts`) must equal whatever cadence is actually driving the route — Vercel Cron or an external pinger — or the agent will promise the shop a wake time the scheduler cannot keep. Neither the cadence choice nor that constant was changed by this ADR; it records the dependency.
- A wake is bounded on three independent axes (`MAX_ITERS_PER_WAKE`, `maxDuration`, `WAKE_BATCH`), so a single slow task or a whole slow tick degrades gracefully into "picked up next tick" rather than a stuck queue or an exhausted function.
