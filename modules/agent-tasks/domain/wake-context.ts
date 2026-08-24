import type { AgentMessage } from "@mallet/ai";

/**
 * modules/agent-tasks/domain/wake-context.ts
 * What a background wake is told before it thinks, and when it must not be told anything.
 *
 * Pure, and in domain/ rather than inside the runner, because both functions are judgement CI has
 * to be able to see: one of them decides whether a message is appended to a live customer
 * conversation at all, and the other decides what day the agent believes it is.
 */

/** Matches the column default in shared/db/schema/org-settings.ts and orgPreamble's own fallback. */
export const DEFAULT_TIMEZONE = "America/Los_Angeles";

export interface WakeOrgContext {
  readonly name: string | null;
  readonly timezone: string;
}

/**
 * A timezone Intl will actually accept. `new Intl.DateTimeFormat(_, { timeZone })` throws RangeError
 * on an unknown zone, and an unrecognised value in one org's settings row must degrade to a stated
 * default rather than throw on every wake that org ever takes.
 */
const usableZone = (timezone: string): string => {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
};

/**
 * The instant as the SHOP would read it. Three narrow formatters rather than one broad one: each
 * has a shape that is stable across ICU versions (en-CA gives YYYY-MM-DD, en-GB 24-hour HH:MM),
 * where a single combined format's separators and ordering are not.
 */
const stamp = (now: Date, timeZone: string): string => {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(now);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);
  return `${weekday} ${date} at ${time}`;
};

/**
 * The dated line every wake starts from, in the ORG'S OWN TIMEZONE — never `toISOString()`.
 *
 * This repo has already paid for that mistake once: `modules/ai/api/ai-router.ts` records that UTC
 * rolls over at midnight, which is 5pm Pacific, so every evening the agent believed it was already
 * tomorrow and scheduled onto the wrong day. This is the one driver whose entire job is scheduling,
 * unattended, so it carries the shop's name, its local instant and the zone that instant is in.
 *
 * Persisted as a real user message before the transcript is read, NOT passed as `contextPreamble`:
 * runAgentTurn applies a preamble only to an empty transcript, so it is dropped on exactly the
 * resumed wakes that need it.
 */
export const dateLine = (now: Date, org: WakeOrgContext): AgentMessage => {
  const timezone = usableZone(org.timezone);
  return {
    role: "user",
    kind: "text",
    text:
      `[system] You are working for ${org.name ?? "your organization"} and it is now ` +
      `${stamp(now, timezone)} in ${timezone}, the shop's own timezone — use that, never UTC, ` +
      `whenever you state or schedule a time. You are working this task in the background and ` +
      `nobody at the shop is watching this conversation. Before you stop, call schedule_next_step ` +
      `or finish_task.`,
  };
};

/**
 * A stored transcript whose last message is an assistant turn with an unanswered `tool_use`.
 *
 * The loop resolves that shape ITSELF — it is the resume path the execution ledger exists for — by
 * inspecting exactly this position, so this predicate has to stay byte-identical to
 * `runAgentTurn`'s own `pendingTurn` check. A user message appended after such a turn makes the
 * tail a user turn, the loop stops recognising the resume, and the provider is handed a `tool_use`
 * with no matching `tool_result`: a hard 400 on every wake, forever, on precisely the
 * crash-recovery path this feature exists to survive.
 *
 * It is NOT a crash-only shape. `synthesizeFinal` pushes its synthetic results with `messages.push`
 * instead of the reporting `append`, so at MAX_ITERS_PER_WAKE = 3 an iteration-capped wake
 * routinely leaves the STORED transcript dangling even though the in-memory one was resolved.
 */
export const awaitsToolResults = (messages: readonly AgentMessage[]): boolean => {
  const last = messages[messages.length - 1];
  return last?.role === "assistant" && last.blocks.some((b) => b.type === "tool_use");
};
