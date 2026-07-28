import type { OrgId } from "@mallet/shared/types";
import { classifyReply } from "../domain/reply-intent";
import type { StaffByPhoneReader, SmsSessionStore, StaffReplySender, StaffIdentity } from "../domain/ports";

/** One pending mutation the agent is waiting on, as runAgentTurn reports it. */
export interface PendingAction {
  readonly toolUseId: string;
  readonly tool: string;
  readonly summary: string;
}

/** The subset of AgentResult this use case needs. Structural, so it does not import the ai module. */
export type TurnResult =
  | { readonly status: "completed"; readonly text: string; readonly transcript: string }
  | { readonly status: "refused"; readonly text: string; readonly transcript: string }
  | {
      readonly status: "needs_approval";
      readonly assistantText: string;
      readonly pending: readonly PendingAction[];
      readonly transcript: string;
    };

export interface RunTurnInput {
  readonly staff: StaffIdentity;
  /** A new instruction from the staffer. Absent when resuming an approval. */
  readonly userMessage?: string;
  /** Prior conversation, opaque. */
  readonly transcript: string | null;
  readonly approvedToolUseIds?: readonly string[];
  readonly deniedToolUseIds?: readonly string[];
}

export interface HandleStaffSmsDeps {
  readonly staffReader: StaffByPhoneReader;
  readonly sessions: SmsSessionStore;
  readonly runTurn: (input: RunTurnInput) => Promise<TurnResult>;
  readonly reply: StaffReplySender;
}

export interface HandleStaffSmsCommand {
  /**
   * The sender. This ALONE establishes both who is asking and which shop's books they may touch —
   * there is no orgId on this command by design. Every shop's staff texts one shared Mallet
   * assistant number, so a caller-supplied org would be a caller-chosen tenant.
   */
  readonly fromPhone: string;
  readonly body: string;
}

export type HandleStaffSmsResult =
  /** Not a verified staff number — the caller must fall through to the customer path unchanged. */
  | { readonly handled: false }
  | { readonly handled: true; readonly orgId: OrgId; readonly replied: string };

// How the yes/no question is put to the staffer. One line, because it arrives as a text.
const askToConfirm = (assistantText: string, pending: readonly PendingAction[]): string => {
  const what = pending.map((p) => p.summary).join("; ");
  const lead = assistantText.trim();
  // The summary is the load-bearing part — it is what a "yes" authorises — so it goes last, next
  // to the instruction, rather than being buried behind the model's preamble.
  return lead ? `${lead}\n\n${what}\n\nReply YES to confirm, or NO to cancel.` : `${what}\n\nReply YES to confirm, or NO to cancel.`;
};

/**
 * Handle one inbound text from a (possibly) staff number.
 *
 * Not staff → returns {handled:false} and touches nothing, so an unrecognised number keeps the
 * existing customer behaviour exactly.
 *
 * CALLER CONTRACT: this runs the agent, which is a multi-minute operation (opus, effort high, up
 * to 15 tool iterations). It MUST NOT be awaited inside the Twilio webhook response — Twilio times
 * out around 15 seconds and retries, which would run the staffer's instruction twice. Call it from
 * `after()`.
 */
export async function handleStaffSms(
  deps: HandleStaffSmsDeps,
  cmd: HandleStaffSmsCommand,
): Promise<HandleStaffSmsResult> {
  const staff = await deps.staffReader.findStaffByPhone(cmd.fromPhone);
  if (!staff) return { handled: false };

  const session = await deps.sessions.find(cmd.fromPhone);
  const pendingIds = session?.pendingToolUseIds ?? [];
  const intent = classifyReply(cmd.body, pendingIds.length > 0);

  const turn = await deps.runTurn(
    intent.kind === "approve"
      ? { staff, transcript: session?.transcript ?? null, approvedToolUseIds: pendingIds }
      : intent.kind === "deny"
        ? { staff, transcript: session?.transcript ?? null, deniedToolUseIds: pendingIds }
        : // A new instruction ABANDONS any outstanding approval rather than carrying it forward.
          // Carrying it would let an unrelated later "yes" fire a mutation the staffer had moved
          // on from. Abandoning is recoverable; a wrongly-sent invoice is not.
          { staff, transcript: session?.transcript ?? null, userMessage: cmd.body },
  );

  const body =
    turn.status === "needs_approval" ? askToConfirm(turn.assistantText, turn.pending) : turn.text;

  await deps.sessions.save({
    userId: staff.userId,
    phone: cmd.fromPhone,
    transcript: turn.transcript,
    pendingToolUseIds: turn.status === "needs_approval" ? turn.pending.map((p) => p.toolUseId) : [],
    pendingSummary: turn.status === "needs_approval" ? turn.pending.map((p) => p.summary).join("; ") : null,
  });

  // Saved BEFORE sending: if the send fails the conversation is still intact and the staffer can
  // ask again. Sending first and failing to save would leave the agent waiting on an approval it
  // has no record of, so a later "yes" would read as a brand-new instruction.
  await deps.reply.send({ orgId: staff.orgId, toPhone: cmd.fromPhone, body });

  return { handled: true, orgId: staff.orgId, replied: body };
}
