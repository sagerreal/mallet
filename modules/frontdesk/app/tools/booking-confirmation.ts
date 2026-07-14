import { isOk } from "@mallet/shared/types";
import type { Phone } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { VoiceToolContext } from "./tool-result";

// ── Booking-confirmation SMS ──────────────────────────────────────────────────
// A one-time transactional text sent right after a successful booking on an inbound call — TCPA-
// safe. The channel + kind + STOP language are fixed constants; the body is composed from the brand
// name and the same slot phrase book_visit speaks. While A2P is blocked the sender is a logging
// stub, so the send degrades gracefully: a failure, the stub, or an unexpected throw NEVER fails
// the booking (it has already succeeded) — every path is logged and swallowed here.

const SMS_CHANNEL = "sms" as const;
export const BOOKING_CONFIRMATION_KIND = "booking_confirmation";
const STOP_OPT_OUT = "Reply STOP to opt out.";

// The confirmation text: brand + the booked slot phrase + the fixed opt-out. Pure helper so the
// exact wording is asserted in a unit test and reused nowhere by copy-paste. No dollar amount — the
// spoken line states the sanctioned price; the SMS is a plain time confirmation.
export const confirmationSms = (brandName: string, slot: string): string =>
  `You're booked with ${brandName} for ${slot}. ${STOP_OPT_OUT}`;

// Fire the one-time booking-confirmation SMS. Background-path semantics: the send returns a Result,
// but the booking has ALREADY succeeded, so an err (or the logging stub while A2P is blocked) or an
// unexpected throw is logged and swallowed — it must NEVER fail the booking or bubble a throw. The
// idempotencyKey is keyed on the job id (one confirmation per booked job); combined with the runner
// ledger's at-most-once-per-toolCallId guarantee, a Vapi tool retry returns the cached result
// without re-sending. Phone is already validated (book_visit gates booking on a valid phone).
export const sendBookingConfirmation = async (
  jobId: string,
  phone: Phone,
  brandName: string,
  slot: string,
  ctx: VoiceToolContext,
): Promise<void> => {
  try {
    const receipt = await ctx.deps.notificationSender.send({
      orgId: ctx.orgId,
      channel: SMS_CHANNEL,
      to: phone,
      body: confirmationSms(brandName, slot),
      kind: BOOKING_CONFIRMATION_KIND,
      idempotencyKey: `booking-confirm-${jobId}`,
    });
    if (!isOk(receipt)) {
      // Degraded, not fatal: the office still has the booking on the board. Logged so it's visible.
      logger.warn(
        { orgId: ctx.orgId, tool: "book_visit", jobId, error: receipt.error.message },
        "frontdesk.book_visit.confirmation_sms_degraded",
      );
      return;
    }
    logger.info(
      { orgId: ctx.orgId, tool: "book_visit", jobId, externalId: receipt.value.externalId },
      "frontdesk.book_visit.confirmation_sms_sent",
    );
  } catch (error: unknown) {
    logger.error(
      { orgId: ctx.orgId, tool: "book_visit", jobId, error: error instanceof Error ? error.message : "unknown" },
      "frontdesk.book_visit.confirmation_sms_failed",
    );
  }
};
