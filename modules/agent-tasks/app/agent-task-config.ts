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

/** How long a claimed task stays owned. Longer than the worst-case wake, shorter than a tick gap. */
export const LEASE_MINUTES = 5;

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
