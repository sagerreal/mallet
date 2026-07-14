import { isOk } from "@mallet/shared/types";
import type { Phone } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { VoiceToolContext } from "./tool-result";

// ── Booking-confirmation SMS ──────────────────────────────────────────────────
// A one-time transactional text sent right after a successful booking on an inbound call — TCPA-
// safe. The channel + kind + STOP language are fixed constants; the body is composed from the brand
// name and the same slot phrase book_visit speaks. It is routed through SendNotificationUseCase (NOT
// the raw sender) so it WRITES A NOTIFICATIONS ROW — observable (records stub:logged while A2P is
// blocked). While A2P is blocked the underlying sender is a logging stub, so the send degrades
// gracefully: an err Result, the stub, or an unexpected throw NEVER fails the booking (it has
// already succeeded) — every path is logged and swallowed here.

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
// Result, but the booking has ALREADY succeeded, so an err (or the logging stub while A2P is
// blocked) or an unexpected throw is logged and swallowed — it must NEVER fail the booking or bubble
// a throw. The idempotencyKey is keyed on the job id (one confirmation per booked job); it is a HINT
// for a future real provider — the actual at-most-once guarantee comes from the runner ledger
// (at-most-once per toolCallId), so a Vapi tool retry returns the cached result without re-running
// this send at all. Phone is already validated (book_visit gates booking on a valid phone).
export const sendBookingConfirmation = async (
  jobId: string,
  phone: Phone,
  brandName: string,
  slot: string,
  ctx: VoiceToolContext,
): Promise<void> => {
  try {
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
