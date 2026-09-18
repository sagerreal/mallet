/**
 * modules/notifications/infra/sms-identity.ts
 * WHICH LINE AN AUTOMATED TEXT GOES OUT ON — the precedence, on its own, so it can be read and
 * tested without a database or a Twilio account.
 *
 * Jobber and Housecall Pro both run this sequence, and the order is the whole point:
 *
 *   the shop's own number   once it has one AND a Messaging Service — "all of your automated text
 *                           messages come from the same number associated with your company"
 *   the shared platform line  until then, so a shop can bill on day one while A2P vetting runs
 *   nothing                 when neither is configured — the caller degrades to the logging stub,
 *                           which keeps `assertDelivered` honest instead of claiming a send
 */

/** A resolved sending identity: the number the customer sees, and the service carriers check. */
export interface SmsSendingIdentity {
  readonly fromNumber: string;
  readonly messagingServiceSid: string;
  /** Which line this is, for logs and for the caller's own reasoning. Never shown to a customer. */
  readonly source: "org" | "shared";
}

/** A candidate that may be incomplete — a number with no service, or nothing at all. */
export interface SmsIdentityCandidate {
  readonly fromNumber: string | null | undefined;
  readonly messagingServiceSid: string | null | undefined;
}

/**
 * A candidate counts only when it has BOTH halves.
 *
 * A number without a Messaging Service is not a usable identity: the 10DLC campaign attaches to
 * the service, so a bare `from` is filtered as unregistered traffic even when the campaign is
 * approved and that number sits in the service's own pool. That is precisely how every Mallet text
 * failed before A2P, and it is not worth repeating on a customer's payment reminder.
 */
const complete = (c: SmsIdentityCandidate, source: "org" | "shared"): SmsSendingIdentity | null =>
  c.fromNumber && c.messagingServiceSid
    ? { fromNumber: c.fromNumber, messagingServiceSid: c.messagingServiceSid, source }
    : null;

/** The shop's own line if it is usable, else the shared one, else nothing. */
export const pickSmsIdentity = (
  org: SmsIdentityCandidate,
  shared: SmsIdentityCandidate,
): SmsSendingIdentity | null => complete(org, "org") ?? complete(shared, "shared");
