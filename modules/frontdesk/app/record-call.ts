import { Phone, isOk, type OrgId, type LeadId, type Clock } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { LeadByPhoneReader, LeadUnreadMarker } from "@mallet/messaging";
import type { CreateTaskUseCase } from "@mallet/tasks";
import type { OrgSettings } from "@mallet/settings";
import type { SettingsReader } from "../domain/assistant";
import type {
  FrontdeskCallRepository,
  ToolInvocationLedger,
  CallMessage,
  PriceAudit,
  RecordCallInput,
} from "../domain/call-record";
import { auditPrices } from "./price-audit";
import { deriveDisposition } from "./disposition";

// Office task text when the audit flags a price the agent should never have spoken. The office
// listens to the recording and tightens the prompt. The prefix is exported so the test asserts the
// exact wording without hardcoding it twice.
export const PRICE_REVIEW_TASK_PREFIX = "Review AI call — unapproved price mentioned:";

const buildReviewTaskText = (flagged: readonly string[]): string =>
  `${PRICE_REVIEW_TASK_PREFIX} ${flagged.join(", ")}`;

// The command the route hands in after parsing the end-of-call-report + resolving the org by the
// To-number. leadId is deliberately absent here: RecordCallUseCase RE-RESOLVES the lead from the
// call's from-number (a late null must never blind-clobber a good skeleton-time leadId).
export interface RecordCallCmd {
  readonly orgId: OrgId;
  readonly vapiCallId: string;
  readonly fromNumber: string;
  readonly toNumber: string;
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
  readonly endedReason: string | null;
  readonly transcript: string | null;
  readonly messages: readonly CallMessage[] | null;
  readonly recordingUrl: string | null;
  readonly summary: string | null;
}

// All ports the use-case needs, injected (DI). No drizzle import here — the route builds these from
// the tenant tx.
export interface RecordCallDeps {
  readonly calls: FrontdeskCallRepository;
  readonly ledger: ToolInvocationLedger;
  readonly settings: SettingsReader;
  readonly leadByPhone: LeadByPhoneReader;
  readonly unreadMarker: LeadUnreadMarker;
  readonly createTask: CreateTaskUseCase;
  readonly clock: Clock;
}

/**
 * Persists a completed call: derive its disposition from the tool ledger, audit spoken prices,
 * store the row, mark the matched lead unread, and file a review task on a price violation.
 *
 * Failure policy (no-silent-failure, but a webhook handler must not crash on a soft miss): a
 * missing lead, empty ledger, or missing settings degrade to a logged best-effort persist — they
 * never throw. Unexpected persistence errors DO propagate so the route can 5xx and Vapi retries
 * (the unique index absorbs the replay).
 */
export class RecordCallUseCase {
  constructor(private readonly deps: RecordCallDeps) {}

  async exec(cmd: RecordCallCmd): Promise<void> {
    const leadId = await this.resolveLead(cmd.fromNumber);
    const disposition = deriveDisposition(await this.loadLedger(cmd.vapiCallId));
    const priceAudit = await this.runPriceAudit(cmd);
    // Read BEFORE the upsert overwrites priceAudit: a Vapi end-of-call RETRY finds the row already
    // flagged, so we skip the (non-idempotent) CreateTask and avoid a duplicate price-review task.
    const alreadyFlagged = await this.wasAlreadyPriceFlagged(cmd.vapiCallId);

    const input: RecordCallInput = {
      orgId: cmd.orgId,
      leadId,
      vapiCallId: cmd.vapiCallId,
      fromNumber: cmd.fromNumber,
      toNumber: cmd.toNumber,
      startedAt: cmd.startedAt,
      endedAt: cmd.endedAt,
      endedReason: cmd.endedReason,
      transcript: cmd.transcript,
      messages: cmd.messages,
      recordingUrl: cmd.recordingUrl,
      summary: cmd.summary,
      disposition,
      priceAudit,
    };
    await this.deps.calls.recordEndOfCall(input);

    logger.info(
      { vapiCallId: cmd.vapiCallId, orgId: cmd.orgId, disposition, leadMatched: leadId !== null },
      "frontdesk.call.recorded",
    );

    if (leadId !== null) await this.markUnread(leadId, cmd.vapiCallId);
    if (priceAudit && priceAudit.flagged.length > 0 && !alreadyFlagged) {
      await this.fileReviewTask(cmd, leadId, priceAudit.flagged);
    }
  }

  // Whether the stored row was already price-flagged before this write. A lookup error is logged
  // and treated as "not flagged" (recording the call + surfacing a NEW violation matters more than
  // suppressing a rare duplicate on a DB hiccup).
  private async wasAlreadyPriceFlagged(vapiCallId: string): Promise<boolean> {
    try {
      return await this.deps.calls.wasPriceFlagged(vapiCallId);
    } catch (error: unknown) {
      logger.warn(
        { vapiCallId, error: messageOf(error) },
        "frontdesk.call.price_flag_check_failed",
      );
      return false;
    }
  }

  // Re-resolve the lead by the call's from-number. A miss returns null (there genuinely is no lead)
  // — recordEndOfCall then carries null forward; it never clobbers an already-linked row because
  // the repo only sets leadId when we pass a value. Any lookup error is logged and treated as a
  // miss (recording the call matters more than the link).
  private async resolveLead(fromNumber: string): Promise<LeadId | null> {
    const parsed = Phone.parse(fromNumber);
    if (!isOk(parsed)) return null;
    try {
      const hit = await this.deps.leadByPhone.findLeadByPhone(parsed.value);
      return hit ? hit.leadId : null;
    } catch (error: unknown) {
      logger.warn(
        { fromNumber, error: messageOf(error) },
        "frontdesk.call.lead_resolve_failed",
      );
      return null;
    }
  }

  private async loadLedger(vapiCallId: string): Promise<{ tool: string; result: unknown }[]> {
    try {
      return await this.deps.ledger.listByCall(vapiCallId);
    } catch (error: unknown) {
      logger.warn({ vapiCallId, error: messageOf(error) }, "frontdesk.call.ledger_load_failed");
      return [];
    }
  }

  // Audit the assistant-spoken lines against the org's sanctioned amounts. Missing settings ⇒ we
  // cannot know the allowed set, so store null (unknown) rather than flag every price falsely.
  private async runPriceAudit(cmd: RecordCallCmd): Promise<PriceAudit | null> {
    const settings = await this.deps.settings.getByOrg(cmd.orgId);
    if (!settings) {
      logger.warn({ orgId: cmd.orgId }, "frontdesk.call.no_settings_for_audit");
      return null;
    }
    const allowed = allowedDollars(settings);
    const spoken = assistantLines(cmd.messages);
    return { flagged: auditPrices(spoken, allowed) };
  }

  private async markUnread(leadId: LeadId, vapiCallId: string): Promise<void> {
    try {
      await this.deps.unreadMarker.markLeadUnread(leadId, this.deps.clock.now());
    } catch (error: unknown) {
      logger.warn(
        { vapiCallId, leadId, error: messageOf(error) },
        "frontdesk.call.mark_unread_failed",
      );
    }
  }

  private async fileReviewTask(
    cmd: RecordCallCmd,
    leadId: LeadId | null,
    flagged: readonly string[],
  ): Promise<void> {
    try {
      const result = await this.deps.createTask.exec(
        { leadId, text: buildReviewTaskText(flagged), dueDate: null },
        cmd.orgId,
      );
      if (!isOk(result)) {
        logger.warn(
          { vapiCallId: cmd.vapiCallId, orgId: cmd.orgId, error: result.error.message },
          "frontdesk.call.review_task_failed",
        );
      }
    } catch (error: unknown) {
      logger.warn(
        { vapiCallId: cmd.vapiCallId, orgId: cmd.orgId, error: messageOf(error) },
        "frontdesk.call.review_task_threw",
      );
    }
  }
}

// The sanctioned spoken amounts: the service/diagnostic fee + every flat-lane service price. Repair
// and estimate lanes never carry a speakable price. All in DOLLARS (playbook parity).
const allowedDollars = (settings: OrgSettings): number[] => {
  const booking = settings.props.booking;
  const flatPrices = booking.services
    .filter((s) => s.lane === "flat" && typeof s.price === "number")
    .map((s) => s.price as number);
  return [booking.serviceFee, ...flatPrices];
};

// The roles Vapi uses for the AI's own turns. Vapi's end-of-call artifact.messages labels the
// agent as "bot" (NOT "assistant"), while the assistant-request / streaming APIs use "assistant" —
// the audit must recognize BOTH or it no-ops on real end-of-call traffic (the price-safety layer).
// Compared case-insensitively so a "Bot"/"Assistant" variant still counts.
const AI_ROLES: ReadonlySet<string> = new Set(["assistant", "bot"]);

// Normalize a raw message role to the canonical AI-vs-not check. Kept a single helper so every
// future reader classifies roles the same way (no drift between the audit and other consumers).
const isAiRole = (role: string): boolean => AI_ROLES.has(role.trim().toLowerCase());

// Only the AI's own turns are audited — a caller quoting a competitor's price is not a violation.
// A turn with no text contributes nothing.
const assistantLines = (messages: readonly CallMessage[] | null): string[] =>
  (messages ?? [])
    .filter((m) => isAiRole(m.role) && typeof m.message === "string")
    .map((m) => m.message as string);

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : "unknown error";
