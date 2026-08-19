/**
 * lib/analytics/events.ts
 * Every event this product sends, named in ONE place.
 *
 * WHY A CLOSED LIST AND NOT AUTOCAPTURE. PostHog's autocapture records the text inside whatever
 * was clicked, and almost every clickable thing in Mallet has a customer's name, address, phone
 * number or invoice total inside it. Autocapture here would quietly ship a shop's customer list
 * to a third party — people who never heard of Mallet, let alone agreed to be measured by it.
 *
 * So nothing is captured automatically. An event exists because somebody added it to this list,
 * and its properties are ids, counts and enums. Never free text, never a name, never an address.
 *
 * The naming is `noun_verbed`, past tense: the event records something that already happened.
 */

export const ANALYTICS_EVENTS = {
  // ── the money path, which is the only funnel that matters commercially ────
  quoteSent: "quote_sent",
  quoteApproved: "quote_approved",
  invoiceSent: "invoice_sent",
  paymentTaken: "payment_taken",

  // ── the field loop ────────────────────────────────────────────────────────
  jobScheduled: "job_scheduled",
  visitStarted: "visit_started",
  visitCompleted: "visit_completed",
  hoursSubmitted: "hours_submitted",

  // ── activation: did this shop ever get going ──────────────────────────────
  orgProvisioned: "org_provisioned",
  memberInvited: "member_invited",
  pricebookImported: "pricebook_imported",
  roomScanned: "room_scanned",
} as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/**
 * What an event may carry. Deliberately narrow: ids to join on, numbers to sum, short enums to
 * split by. A `string` that is not an id or an enum is how a customer's name ends up in an
 * analytics warehouse, so the type does not allow one.
 */
export interface AnalyticsProps {
  readonly [key: string]: string | number | boolean | null | undefined;
}
