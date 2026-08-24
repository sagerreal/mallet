import { MAX_STEP_DAYS, MIN_STEP_MINUTES } from "../app/agent-task-config";

/**
 * modules/agent-tasks/domain/next-step.ts
 * When a requested wake actually lands.
 *
 * Enforced in code, never in the prompt: a model that can ask to be woken in ten seconds will,
 * and the scheduler cannot serve it. Clamping (rather than refusing) keeps the agent moving —
 * the tool tells it what it actually got so it can say something honest to the shop.
 */
export interface ClampedStep {
  readonly at: Date;
  readonly clamped: "min" | "max" | null;
}

export const clampNextStep = (requested: Date, now: Date): ClampedStep => {
  const floor = new Date(now.getTime() + MIN_STEP_MINUTES * 60_000);
  const ceiling = new Date(now.getTime() + MAX_STEP_DAYS * 86_400_000);
  const wanted = requested.getTime();
  // `new Date("nonsense").getTime()` is NaN, and NaN < anything is false — without the explicit
  // check a bad string would fall through to the "just right" branch and hand the runner a task
  // row with an unparseable timestamp instead of a clamp it can act on.
  if (Number.isNaN(wanted) || wanted < floor.getTime()) return { at: floor, clamped: "min" };
  if (wanted > ceiling.getTime()) return { at: ceiling, clamped: "max" };
  return { at: requested, clamped: null };
};
