import { ok, type Result, type ValidationError } from "@mallet/shared/types";
import type { AgentTask } from "./agent-task";
import type { WakeDecision } from "./wake-decision";

/**
 * modules/agent-tasks/domain/wake-outcome.ts
 * Turning a wake's decision — or its failure — into exactly one aggregate transition and one name.
 *
 * Pure, and in domain/ beside decideWake rather than inside the runner, because these three
 * branches are judgement CI has to be able to see. The runner's own file is excluded from coverage
 * on the argument that its judgement lives here; that argument is only honest if this is here.
 */

/** How one wake ended. Every value is also a `TickSummary` counter, so a wake tallies itself. */
export type WakeDisposition =
  | "scheduled"
  | "finished"
  | "handedOver"
  | "backedOff"
  | "abandoned"
  | "failed"
  | "raced";

/**
 * The tick ran out of its wall-clock budget while this turn was still going.
 *
 * Thrown from the runner's `onProgress`, which `runAgentTurn` awaits without catching — so the
 * turn aborts at the next message boundary, which is the only place the transcript is consistent.
 * Distinct from every other failure because it is the runner's own choice, not the provider's.
 */
export class TickBudgetExceeded extends Error {
  constructor() {
    super("the tick ran out of wall-clock budget mid-turn");
    this.name = "TickBudgetExceeded";
  }
}

/** The low-cardinality discriminator `last_error` carries for the case above. PII-free by shape. */
export const TICK_BUDGET_ERROR = "tick_budget";

/**
 * A retryable provider failure, recognised STRUCTURALLY rather than with `instanceof LlmError`.
 *
 * domain/ cannot take a VALUE import from the `@mallet/ai` barrel: the barrel exports the tRPC
 * router, which pulls the DB config validator, which throws with no env — so any unit test
 * importing this file would fail to load (the gotcha CLAUDE.md names). `wake-decision.ts` stays
 * clean for the same reason: its `@mallet/ai` import is type-only and erased at runtime.
 *
 * `LlmError` sets `name = "LlmError"` in its constructor and carries `retryable` as a public
 * readonly field, so both are stable to read. That the predicate matches the REAL class (not just
 * this shape) is proven end-to-end by the runner's integration tests, which drive it with a live
 * `new LlmError(true)` and `new LlmError(false)`.
 */
const isRetryableProviderError = (error: unknown): boolean =>
  error instanceof Error &&
  error.name === "LlmError" &&
  (error as Error & { readonly retryable?: unknown }).retryable === true;

/**
 * What to do with a turn that threw.
 *
 * `back_off`: a retryable provider blip. Reschedule spending NEITHER budget — otherwise one
 * rate-limited org burns something on every one of its tasks in a single tick.
 * `abandon`: our own deadline. A real attempt IS spent, plus a `tick_budget` trail, so a task that
 * reliably outlives the function retires to a human instead of retrying forever at full LLM cost.
 * `fail`: anything else, including a NON-retryable LlmError — a real failure with a real attempt.
 */
export const classifyTurnFailure = (error: unknown): "back_off" | "abandon" | "fail" => {
  if (error instanceof TickBudgetExceeded) return "abandon";
  if (isRetryableProviderError(error)) return "back_off";
  return "fail";
};

/**
 * `auto_approve` is never a wake's FINAL decision — it means "re-enter the loop with these ids
 * approved", not "settle the task row". The runner intercepts it in `wakeOne` before either
 * function below ever sees it (re-entering once, then re-deciding on the result of that). An
 * `asserts` guard rather than a plain `if`, so the compiler — not just a runtime throw — proves
 * `decision.note` below can never read `undefined` off the variant that has no such field. Throwing
 * (instead of silently falling into the hand-over branch) is deliberate: the tick's own per-task
 * try/catch still stops one bad decision from stranding the rest of the batch, and a loud crash
 * here is far cheaper to notice than a wrong note written to a shop's task.
 */
function assertSettleable(decision: WakeDecision): asserts decision is Exclude<WakeDecision, { kind: "auto_approve" }> {
  if (decision.kind === "auto_approve") {
    throw new Error("auto_approve must be resolved by the runner before settling a wake");
  }
}

/**
 * The ONE transition a decision maps to. `needsYou` cannot fail by design (the hand-over path must
 * never itself refuse), so it is lifted into an ok Result to give all three branches one shape.
 */
export const applyDecision = (
  task: AgentTask,
  decision: WakeDecision,
  now: Date,
): Result<AgentTask, ValidationError> => {
  assertSettleable(decision);
  if (decision.kind === "schedule") return task.scheduleNext(decision.at, decision.note, now);
  if (decision.kind === "finish") return task.finish(decision.summary, now);
  return ok(task.needsYou(decision.note, now));
};

export const dispositionOf = (decision: WakeDecision): WakeDisposition => {
  assertSettleable(decision);
  if (decision.kind === "schedule") return "scheduled";
  if (decision.kind === "finish") return "finished";
  return "handedOver";
};
