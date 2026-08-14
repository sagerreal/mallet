import { isOk } from "@mallet/shared/types";
import type { Phone } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { VoiceToolContext } from "./tool-result";

// ── Booking-confirmation SMS ──────────────────────────────────────────────────
// A one-time transactional text sent right after a successful booking on an inbound call — TCPA-
// safe. The channel + kind + STOP language are fixed constants; the body is composed from the brand
// name and the same slot phrase book_visit speaks. It is routed through SendNotificationUseCase (NOT
// the raw sender) so it WRITES A NOTIFICATIONS ROW — observable.
//
// COMPLIANCE GATE: voice calls themselves are never gated (10DLC governs SMS, not voice), but this
// one background SMS is real A2P traffic the moment the platform's SMS channel is configured — which
// it is in prod. Before sending, we read the SAME `GetA2pStatusUseCase.canText` check every other
// SMS-capable path in the app gates on (via ctx.deps.canSendAutomatedSms, bound to this call's org by the
// composition root — never a model/client-supplied org id). A non-active org SKIPS the send (never
// throws): this is a fire-and-forget background path with no human awaiting a synchronous response,
// so the booking must never fail on it — but an unregistered org must never actually transmit SMS
// either. (A stale in-code comment here used to claim the underlying sender degrades to a logging
// stub "while A2P is blocked" — that conflated an unrelated, unconfigured-channel stub with per-org
// 10DLC state and was never actually a gate. This explicit check replaces that false rationale.)
// Beyond the gate: an err Result, or an unexpected throw, NEVER fails the booking (it has already
// succeeded) — every path is logged and swallowed here.

const SMS_CHANNEL = "sms" as const;
export const BOOKING_CONFIRMATION_KIND = "booking_confirmation";
const STOP_OPT_OUT = "Reply STOP to opt out.";

// A booking confirmation is not tied to an invoice/estimate follow-up ladder, so it carries no
// related entity and no reminder stage.
const NO_RELATED_TYPE = null;
const NO_RELATED_ID = null;
const NO_REMINDER_STAGE = null;

// The confirmation text: brand + the booked slot phrase + the fixed opt-out. Pure helper so the
// exact wording is asserted in a unit test and reused nowhere by copy-paste. No dollar amount — the
// spoken line states the sanctioned price; the SMS is a plain time confirmation.
export const confirmationSms = (brandName: string, slot: string): string =>
  `You're booked with ${brandName} for ${slot}. ${STOP_OPT_OUT}`;

// Fire the one-time booking-confirmation SMS through SendNotificationUseCase (writes a notifications
// row + claims the idempotency key at the ledger). Background-path semantics: the send returns a
// Result, but the booking has ALREADY succeeded, so an err or an unexpected throw is logged and
// swallowed — it must NEVER fail the booking or bubble a throw. The idempotencyKey is keyed on the
// job id (one confirmation per booked job); it is a HINT for a future real provider — the actual
// at-most-once guarantee comes from the runner ledger (at-most-once per toolCallId), so a Vapi tool
// retry returns the cached result without re-running this send at all. Phone is already validated
// (book_visit gates booking on a valid phone).
export const sendBookingConfirmation = async (
  jobId: string,
  phone: Phone,
  brandName: string,
  slot: string,
  ctx: VoiceToolContext,
): Promise<void> => {
  try {
    // COMPLIANCE GATE (see file header): with no line to send from at all, skip — logged, never
    // thrown — so the booking still succeeds and nothing unregistered goes out. A shop with no
    // campaign of its own is NOT skipped any more: its confirmation rides Mallet's shared line,
    // which is the point of that line. Only a total absence of any registered line stops it.
    const canSend = await ctx.deps.canSendAutomatedSms();
    if (!canSend) {
      logger.info(
        { orgId: ctx.orgId, tool: "book_visit", jobId },
        "frontdesk.book_visit.confirmation_sms_skipped_no_line",
      );
      return;
    }

    const result = await ctx.deps.sendNotification.exec({
      orgId: ctx.orgId,
      channel: SMS_CHANNEL,
      to: phone,
      body: confirmationSms(brandName, slot),
      kind: BOOKING_CONFIRMATION_KIND,
      relatedType: NO_RELATED_TYPE,
      relatedId: NO_RELATED_ID,
      reminderStage: NO_REMINDER_STAGE,
      idempotencyKey: `booking-confirm-${jobId}`,
    });
    if (!isOk(result)) {
      // Degraded, not fatal: the office still has the booking on the board. Logged so it's visible.
      logger.warn(
        { orgId: ctx.orgId, tool: "book_visit", jobId, error: result.error.message },
        "frontdesk.book_visit.confirmation_sms_degraded",
      );
      return;
    }
    logger.info(
      { orgId: ctx.orgId, tool: "book_visit", jobId, notificationId: result.value.props.id, status: result.value.props.status },
      "frontdesk.book_visit.confirmation_sms_sent",
    );
  } catch (error: unknown) {
    logger.error(
      { orgId: ctx.orgId, tool: "book_visit", jobId, error: error instanceof Error ? error.message : "unknown" },
      "frontdesk.book_visit.confirmation_sms_failed",
    );
  }
};
