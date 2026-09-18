/**
 * What the carrier said happened to a text.
 *
 * Until this existed a message was written "sent" and never touched again, so one the carrier
 * silently dropped looked identical to one that landed. That is not a cosmetic gap: a shop chasing
 * a customer who never got the appointment reminder has no way to discover the text never arrived.
 */

/** Our own vocabulary. Twilio's finer-grained statuses collapse into these. */
export type DeliveryStatus = "queued" | "sent" | "delivered" | "failed" | "received";

/**
 * Twilio's `MessageStatus` → ours.
 *
 * `sent` means the carrier ACCEPTED it, not that a handset got it — which is exactly the confusion
 * this whole change exists to end, so it stays distinct from `delivered`.
 */
const FROM_TWILIO: Readonly<Record<string, DeliveryStatus>> = Object.freeze({
  queued: "queued",
  accepted: "queued",
  scheduled: "queued",
  sending: "sent",
  sent: "sent",
  delivered: "delivered",
  read: "delivered",
  undelivered: "failed",
  failed: "failed",
  canceled: "failed",
});

export const deliveryStatusOf = (twilioStatus: string): DeliveryStatus | null =>
  Object.prototype.hasOwnProperty.call(FROM_TWILIO, twilioStatus)
    ? FROM_TWILIO[twilioStatus]!
    : null;

/** A status that can never change again — a later callback for one is stale and must be ignored. */
export const isTerminal = (status: DeliveryStatus): boolean =>
  status === "delivered" || status === "failed";

/**
 * Rank, so an out-of-order callback cannot walk a message BACKWARDS.
 *
 * Twilio does not guarantee ordering, and a `sent` arriving after a `delivered` would otherwise
 * un-deliver a message that plainly arrived.
 */
const RANK: Readonly<Record<DeliveryStatus, number>> = Object.freeze({
  queued: 0,
  sent: 1,
  received: 1,
  delivered: 2,
  failed: 2,
});

export const supersedes = (next: DeliveryStatus, current: DeliveryStatus): boolean =>
  RANK[next] > RANK[current];

export interface SmsFailure {
  readonly code: string;
  readonly says: string;
  readonly fix: string | null;
}

/**
 * The codes a trade shop will actually hit, in plain words.
 *
 * 30034 is the one that matters most here: it is what a carrier returns when the sending number is
 * not registered for A2P 10DLC, and it is invisible without this whole mechanism — the send
 * SUCCEEDS at Twilio and the message simply never arrives.
 */
const FAILURES: Readonly<Record<string, { says: string; fix: string | null }>> = Object.freeze({
  "30034": {
    says: "The carrier blocked it — this number isn't registered for business texting yet.",
    fix: "Finish 10DLC registration in Settings, or use a toll-free number.",
  },
  "30003": { says: "Their phone was unreachable — switched off, or out of service.", fix: null },
  "30004": {
    says: "Their carrier blocked the message.",
    fix: "They may have blocked your number.",
  },
  "30005": { says: "That number doesn't exist.", fix: "Check the number on their record." },
  "30006": {
    says: "That's a landline, so it can't receive texts.",
    fix: "Call them instead, or ask for a mobile.",
  },
  "30007": {
    says: "The carrier filtered it as spam.",
    fix: "Shorten it, drop the links, and avoid all-caps.",
  },
  "30008": { says: "The carrier gave no reason.", fix: "Try again — this one is usually temporary." },
  "21610": {
    says: "They replied STOP, so we can't text them.",
    fix: "They have to text START to your number to opt back in.",
  },
  "21614": { says: "That number can't receive texts.", fix: "Check it's a mobile." },
});

/**
 * Explain a failure. Never returns null for a failed message: an unrecognised code still produces a
 * visible row, because "we have no friendly name for this" is not a reason to let somebody believe
 * a text arrived when it did not.
 */
export const explainSmsFailure = (code: string | null): SmsFailure => {
  const key = code ?? "";
  if (Object.prototype.hasOwnProperty.call(FAILURES, key)) {
    const known = FAILURES[key]!;
    return { code: key, says: known.says, fix: known.fix };
  }
  return {
    code: key || "unknown",
    says: "The carrier didn't deliver it.",
    fix: key ? `Carrier code ${key}.` : null,
  };
};
