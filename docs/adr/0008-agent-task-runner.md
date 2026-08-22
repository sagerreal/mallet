# ADR 0008: Durable agent tasks + a leased, scheduler-driven runner

- **Status:** Accepted
- **Date:** 2026-08-20
- **Context:** every agent surface Mallet has shipped so far (`modules/ai`'s in-process loop, the ADR 0006 MCP server, the ADR 0007 confirm flow) is **request-scoped** — it exists for the lifetime of one HTTP call, driven by a human or host who is watching. An AI *employee*, by contrast, needs to hold work that outlives the request that created it: "text the customer back when they reply," "follow up in three days if the quote isn't accepted," "check the crew's calendar every morning." None of that survives a closed laptop unless the work itself is a durable, server-owned row and something wakes it up without a human in the loop. Design validated against ADR 0003/0004's outbox + relay precedent, which already solved a structurally similar problem for events.

## Decision

### 1. A durable `agent_tasks` table + `runAgentTaskTick`, not a longer-lived request

`modules/agent-tasks` adds `agent_tasks` (RLS-scoped, one row per unit of work: `title`, `status`, `created_by`/`created_by_role` snapshot, `next_action_at`, lease fields, attempt/step counters) and `agent_task_messages` (the per-task transcript). A scheduler POSTs `app/api/cron/agent-runner/route.ts`; each invocation runs one bounded **tick** (`runAgentTaskTick`): claim due tasks across every org, re-enter each org's own tenant transaction, drive the existing agent loop (`runAgentTurn`) for a small, fixed number of iterations, and write back a disposition — `scheduled` (asked to be woken again), `finished`, `needs_you`, `backed_off` (transient LLM failure), or `raced` (lost a version race to a concurrent writer). A truncated tick is safe: the lease expires and the next tick re-claims the row, and the tool executor's execution ledger (same shape the confirm flow already relies on) means a wake killed mid-turn never repeats a committed side effect.

### 2. Amendment to ADR 0003 §2: `agent_tasks` is the second, still-narrow exception to RLS

ADR 0003 §2 named the BYPASSRLS **owner connection** the single sanctioned non-RLS runtime path, and scoped it to the outbox relay's own bookkeeping. This ADR widens that by exactly one table: `modules/agent-tasks/infra/claim-due-tasks.ts`, whose rule a reviewer can mechanically check is:

> The owner connection may read and write `agent_tasks` only through the columns `id, org_id, status, deleted_at, next_action_at, locked_until, lease_id, attempts` — via one atomic `UPDATE … FROM <cte>` whose CTE carries the `FOR UPDATE SKIP LOCKED` (see § below — the `WHERE id IN (SELECT …)` form does NOT hold the batch bound) — and must never read `title` or anything in `agent_task_messages`.

(This list has one more column than the plan's original text — `deleted_at` — because the claim's `WHERE` clause filters on it to skip soft-deleted rows; verified against the shipped statement, not assumed from the plan.)

**A correction to an earlier draft of this section, which said something false twice.** It claimed `claimDueTasks` was "the *only other* caller of the owner connection in the codebase" and that every owner-connection caller returns "ids/status columns only, never tenant content". Both are wrong, and a security review that trusted them would have drawn the wrong map. A grep for `@mallet/shared/db/owner-client` finds **eleven** production callers, not two:

| Caller | Shape |
|---|---|
| `shared/outbox/relay/relay.ts` | the ADR 0003/0004 relay claim + bookkeeping |
| `modules/agent-tasks/infra/claim-due-tasks.ts` | this ADR's claim |
| `modules/quoting/infra/drizzle-public-estimate-reader.ts` | token → estimate; **reads AND writes** (`update(estimates)`), and reads estimate lines and the org name — real tenant content |
| `modules/invoicing/app/public-invoice.ts` | public invoice-by-token read |
| `modules/messaging/infra/drizzle-message-repository.ts` | inbound SMS, before the org is known |
| `modules/calls/infra/drizzle-call-directory.ts` | inbound call routing |
| `modules/inbound/infra/drizzle-inbound-endpoint-resolver.ts` | web-form token → endpoint |
| `modules/sms-agent/infra/drizzle-sms-agent-readers.ts` | SMS-agent reads |
| `modules/a2p/infra/drizzle-registration-repository.ts` | A2P registration state |
| `app/api/inbound/[channel]/[token]/route.ts` | inbound webhook entry |
| `shared/db/owner-client.ts` | the client itself |

They exist for a coherent reason — a webhook, a public token or a relay row arrives with **no authenticated org**, so something has to resolve which tenant it belongs to before `withTenant` can be entered — but that reason is "resolve the tenant", not "return ids only", and several of them go on to read (and one to write) tenant content on that connection.

What this does **not** change: the §2 column restriction above is real and is honoured. `claimDueTasks`' `SET` list is `lease_id, locked_until`; its `WHERE` reads `status, deleted_at, next_action_at, locked_until`; its `RETURNING` is `id, org_id, attempts`. It is the only **cross-tenant** statement in `modules/agent-tasks` (the repository is constructed from an already-org-scoped tx and has no method that could express "every org"). The false part was only the surrounding claim about the rest of the codebase. Widening the owner connection's *inventory* is not what this ADR does; adding one narrow statement to it is.

Verified true of the code as shipped: the statement's `SET` list is `lease_id, locked_until`; its `WHERE` reads `status, deleted_at, next_action_at, locked_until`; its `RETURNING` is `id, org_id, attempts`. No `title`, no join to `agent_task_messages`, no `SELECT *`. The task body — `title`, the transcript, everything an attacker-adjacent or merely-private tenant might care about — is read exactly once the org id is known, inside `withTenant(orgId)`, by `DrizzleAgentTaskRepository`, under ordinary RLS. The owner connection never sees it. Everything else the runner needs (the creator's current role, the transcript, the task row for writing) also goes through `withTenant`, not the owner connection — `claimDueTasks` is the *only* cross-tenant statement in the module, by construction (`AgentTaskRepository` is built from an already-org-scoped tx and has no method that could express "every org").

### 3. Why a lease, when ADR 0004 §4 deliberately left the outbox without one

The outbox relay's claim also uses `FOR UPDATE SKIP LOCKED` with no lease, and ADR 0004 §4 accepted that two overlapping ticks can both dispatch the same row — because outbox handlers are a **documented idempotent contract**. An agent wake is not: a turn can send a text message or create a payment link, and a duplicate wake sends the customer a second message, which is not something a retry policy can undo after the fact. So `claimDueTasks` stamps `lease_id` + `locked_until` in the same statement that claims the row, and every later write to that row (`save`, `releaseLease`) carries the lease id as a fencing token — a worker whose lease already expired can never win a write race against whoever reclaimed the row. This is a real behavioral fork from the outbox precedent, made for the reason the outbox's own ADR named as the boundary of its own safety argument.

What live-DB testing actually surfaced while building this: **the batch bound requires a CTE.** The
obvious form — `UPDATE … WHERE id IN (SELECT … ORDER BY … LIMIT n FOR UPDATE SKIP LOCKED)` —
silently ignores the bound. Measured against the live DB, `limit 2` over 6 due rows leased all 6, and
over 20 due rows leased all 20. It reproduces with raw postgres.js as well as through drizzle, inside
an explicit transaction and in autocommit alike; the sub-SELECT executed on its own returns exactly 2
every time, so it is the `IN (...)` that breaks it. Cause: the planner runs that sub-SELECT as a
SubPlan re-executed once per candidate outer row, and because `SKIP LOCKED` yields a different set on
each execution, nearly every row appears in some execution's result and matches. The `LIMIT` is
honoured — it bounds each execution, not the update. A CTE containing `FOR UPDATE` is never inlined by
Postgres, so it is materialised and evaluated exactly once, which is what actually enforces the bound
(verified: 36 consecutive trials, 6 and 20 candidates, in-transaction and autocommit, all claimed
exactly 2).

An earlier revision of this ADR and of `claim-due-tasks.ts` attributed the same symptom to the
**pooled** owner client (`max: 2`) and prescribed wrapping the statement in `ownerDb.transaction(...)`.
That was wrong in both directions and is recorded here because it was load-bearing documentation for a
while: the wrapper does not fix the over-claim — with the `IN (...)` form it made it reproduce 30/30
instead of intermittently, which is how the real cause above was finally isolated — and the pool was
never involved. The statement now runs through plain `ownerDb.execute()`; a single statement is
already atomic and needs no explicit transaction.

### 3a. The lease's margin, and the residual race it does not close

§3 argues *that* a lease is needed. It did not state the **numbers**, and the first implementation
got them wrong in a way two independent reviews found from different angles. Recording both here,
because the safety argument is entirely in the arithmetic.

**What was wrong.** `LEASE_MINUTES` was a literal `5` — exactly equal to `TICK_CADENCE_MINUTES` (5)
*and* to the route's `maxDuration` (300s). `claimDueTasks` stamps ONE shared `locked_until = now +
LEASE_MINUTES` for the **whole batch** at tick start and never renews it per task, while dispatch is
sequential. So the last task in a batch is fenced only for `lease − (time spent on tasks 1..n-1)`,
and a wake still genuinely mid-turn at 4:59 lost its fence exactly as the next tick fired — which
then reclaimed the row and started a **second concurrent wake on it**. Nothing else catches that:
the version-guarded `save` prevents a corrupted disposition, and the execution ledger prevents a
replayed side effect *within one wake*, but two live wakes mint two different `tool_use` ids, which
nothing dedupes. The customer gets a second text. (A wake killed by the platform is safe by
contrast — a tick's own lease outlives its own forced kill.)

**The relationship now, all derived in `app/agent-task-config.ts` and asserted in its test:**

    LEASE_MINUTES = max(TICK_CADENCE_MINUTES, ceil(TICK_MAX_DURATION_SECONDS / 60)) + 5   = 10
    TICK_BUDGET_MS = (TICK_MAX_DURATION_SECONDS - 60) * 1000                              = 240_000

with `TICK_BUDGET_MS < LEASE_MINUTES × 60_000` and `TICK_BUDGET_MS < TICK_MAX_DURATION_SECONDS ×
1000`. Nothing is a hand-written literal that can drift out of step with the others, and
`TICK_MAX_DURATION_SECONDS` must equal the route's exported `maxDuration`.

Three consequences worth naming:

- The runner stops **claiming new wakes** at `TICK_BUDGET_MS` and releases the untouched tail's
  leases, instead of letting the platform kill it. A killed tick leaves the tail leased-but-unworked
  and the in-flight task with no attempt spent and no `last_error` — so a task that reliably
  outlives the function retried forever, at full LLM cost, with an empty failure trail.
- A wake whose own turn crosses the deadline is aborted at the next message boundary (through
  `onProgress`, which `runAgentTurn` awaits without catching) and **spends a real attempt** plus a
  `tick_budget` discriminator, so it retires to a human via `MAX_ATTEMPTS` rather than looping.
- Every write to the row is fenced on `lease_id` as well as on the version, so a worker that lost
  its lease physically cannot write — `save` guarded by version alone would still match if the new
  owner had not written yet.

**Runner versus human, the same defect through a different door.** `agent-task-router.ts`'s `reply`
originally checked only the version. A *due* task can be mid-wake with an LLM call in flight and the
lease held, at which point the version still matches — so `reply` sailed through and both turns ran
concurrently for a round trip. The final version-guarded `save` still protects the disposition, but
each side's transcript appends commit independently before that, and an interleaved transcript (two
consecutive assistant turns, or tool results answering the other side's ids) is a **hard provider
rejection on every subsequent wake**, self-healing only by burning the attempt budget. `reply` now
**acquires** the lease for the duration of its turn (`acquireLease`, one atomic UPDATE against the
free-lease predicate), releases it on every exit path including a throw, and fences its settle write
on holding that same `lease_id`. A caller that cannot take it gets a `CONFLICT` a person can act on.
It refuses; it never blocks or polls.

**An expired lease counts as ABSENT, not held**, in both the claim's predicate and
`AgentTask.isLeaseLive`. Every path the runner controls releases its lease explicitly, so a stale
`locked_until` means a hard-killed process — and refusing on it would strand the task behind a dead
lock nothing ever clears.

**The residual an earlier draft deferred is now CLOSED, and the reason it had to be.** That draft
recorded the reverse ordering as an accepted risk — a human begins a `reply` on a due-and-unleased
task and the runner claims it milliseconds later — and argued no business side effect could be
duplicated, because a mutating tool needs a per-turn approval the runner cannot supply. True of
runner-versus-human. It missed **human versus human**: `reply` is `ownerOrOffice` and two office
users on the shared "Needs you" queue (or one owner in two browser tabs) can approve the *same*
`tool_use` concurrently. `buildExecuteTool` consults the execution ledger in its OWN short
transaction, so both find nothing, both execute, and the unique `(org_id, tool_use_id)` swallows the
second ledger row via `onConflictDoNothing` — **two texts, or two payment records, and no error
anywhere**. Exactly the harm §3 gives as the lease's reason to exist, reached without the runner
being involved at all.

So `reply` acquires (`REPLY_LEASE_MS`, sized to outlive the tRPC route's own `maxDuration` so a
request killed at the ceiling stays fenced for as long as it really ran), releases in a `finally`,
and settles only while it still holds the lease it took. `close` deliberately CHECKS rather than
acquires: it is one version-guarded UPDATE inside one transaction, which Postgres already serializes,
so a lease would add nothing but a window in which the request could die holding one.

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

- The owner (BYPASSRLS) connection gains exactly one new caller: `claimDueTasks`. It is narrow, auditable by grep, and returns ids/status columns only. It is NOT the second caller overall — see the correction in §2 for the real inventory of eleven, and for why several of the pre-existing ones legitimately do read tenant content on that connection.
- The scheduler cadence is an operational decision, not a code decision: `vercel.json`'s `*/5 * * * *` entry requires a Vercel plan that permits sub-daily cron, and `TICK_CADENCE_MINUTES` (`modules/agent-tasks/app/agent-task-config.ts`) must equal whatever cadence is actually driving the route — Vercel Cron or an external pinger — or the agent will promise the shop a wake time the scheduler cannot keep. Neither the cadence choice nor that constant was changed by this ADR; it records the dependency.
- A wake is bounded on four independent axes (`MAX_ITERS_PER_WAKE`, `TICK_BUDGET_MS`, `maxDuration`, `WAKE_BATCH`), so a single slow task or a whole slow tick degrades gracefully into "picked up next tick" rather than a stuck queue or an exhausted function. `TICK_BUDGET_MS` is the one the runner enforces on itself; `maxDuration` is the platform's backstop, and reaching it means the self-imposed budget was mis-derived — see §3a.
