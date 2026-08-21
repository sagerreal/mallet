/**
 * modules/agent-tasks/app/agent-task-config.ts
 * Named tuning constants for the AI employee. No magic numbers anywhere else in the module.
 */

/**
 * How often the scheduler actually POSTs the runner. THE load-bearing number: it is the real
 * resolution of every promise the agent makes about time. Keep it in step with vercel.json (or
 * whatever external pinger drives the route) — if they disagree, the agent lies to the owner.
 */
export const TICK_CADENCE_MINUTES = 5;

/** The soonest a wake can be asked for: two ticks, so a request never lands before a tick can serve it. */
export const MIN_STEP_MINUTES = TICK_CADENCE_MINUTES * 2;

/** The furthest out a wake can be asked for. Beyond a month, a task is a note, not work in flight. */
export const MAX_STEP_DAYS = 30;

/** Tasks claimed per tick. Small: the app pool is max 10 and dispatch is sequential on purpose. */
export const WAKE_BATCH = 5;

/**
 * The platform ceiling on ONE tick, in seconds — the `maxDuration` the runner's route exports.
 * Named here so the lease window and the tick budget are derived from the number the platform will
 * actually enforce, and so moving one moves all three. It MUST equal the route's own export.
 */
export const TICK_MAX_DURATION_SECONDS = 300;

/**
 * Wall-clock budget for one whole tick, in ms. The runner stops on its own here instead of letting
 * the platform kill it mid-batch.
 *
 * A killed tick leaves the untouched tail of its batch leased-but-unworked AND the in-flight task
 * with no attempt spent and no `last_error` — so a task that reliably outlives the function retries
 * forever, at full LLM cost, with an empty failure trail. Stopping ourselves lets both cases be
 * recorded: the unstarted tail has its lease released (it is genuinely untouched, so the next tick
 * takes it first), and the in-flight task takes a real attempt and a `tick_budget` discriminator.
 *
 * The gap below the ceiling is the room the abandoned task's own settle write needs.
 */
export const TICK_BUDGET_MS = (TICK_MAX_DURATION_SECONDS - 60) * 1_000;

/**
 * The floor a lease has to clear, in minutes. TWO independent bounds, and the lease must beat both:
 *
 *  - `TICK_CADENCE_MINUTES` — a lease that expires before the next tick even fires lets that tick
 *    reclaim a row the previous tick may still be working.
 *  - the whole-tick wall clock (`TICK_MAX_DURATION_SECONDS`) — `claimDueTasks` stamps ONE shared
 *    `locked_until` for the entire batch at tick start and never renews it per task, while dispatch
 *    is sequential. So the LAST task in a batch is fenced only for `lease − (time spent on tasks
 *    1..n-1)`, and the bound that matters is the tick's total wall clock, never one wake's.
 */
const LEASE_FLOOR_MINUTES = Math.max(
  TICK_CADENCE_MINUTES,
  Math.ceil(TICK_MAX_DURATION_SECONDS / 60),
);

/** Slack over the floor, so clock skew or a slow settle write cannot close the gap to zero. */
const LEASE_MARGIN_MINUTES = 5;

/**
 * How long a claimed task stays owned. DERIVED from the two bounds above, never a literal that can
 * drift out of step with them (it was 5 — exactly equal to both the cadence and the ceiling, so a
 * wake still genuinely mid-turn at 4:59 lost its fence precisely as the next tick fired).
 *
 * NOTHING ELSE CATCHES TWO CONCURRENT WAKES ON ONE ROW. The version-fenced `save` stops the row
 * being corrupted and the execution ledger stops a side effect being repeated within one wake's
 * retries — but two genuinely concurrent wakes mint two different `tool_use` ids, which nothing
 * dedupes, so the customer gets a second text or a second payment link. That is the exact harm ADR
 * 0008 §3 gives as the reason this lease exists at all, so the margin is the guard, not a tuning
 * knob. The cost of a longer lease is only latency on a hard-killed wake (its row waits out the
 * window); every path the runner controls releases the lease explicitly.
 */
export const LEASE_MINUTES = LEASE_FLOOR_MINUTES + LEASE_MARGIN_MINUTES;

/** LLM rounds per wake. Deliberately far below runAgentTurn's default of 15: one wake must fit
 *  inside the route's maxDuration, and the task's own next_action_at is how work continues. */
export const MAX_ITERS_PER_WAKE = 3;

/** Consecutive real failures before the task stops trying and asks a human. */
export const MAX_ATTEMPTS = 5;

/** Total wakes one task may ever take. A model that can schedule can also decline to finish. */
export const MAX_STEPS_PER_TASK = 25;

/** Serialized conversation ceiling. Past this the task asks for a human rather than 400-ing. */
export const MAX_TRANSCRIPT_BYTES = 256_000;

/** Open tasks one org may hold. Blast-radius bound, not a business rule. */
export const MAX_OPEN_TASKS_PER_ORG = 50;

export const TITLE_MAX = 120;
export const NOTE_MAX = 280;
