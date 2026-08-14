/**
 * shared/messaging/sms-limits.ts
 *
 * What a carrier will take, stated once for both ends of the wire.
 *
 * The send boundary capped a body at 1600 and the composer knew nothing about it, so a long text
 * was typed in full, sent, and refused — and the thread then reported the refusal as a missing
 * phone number, with the customer's number printed in the header two lines above. A cap the field
 * cannot see is a cap the field walks into.
 *
 * It lives in shared/ rather than modules/messaging/ because it is a CARRIER fact, not a rule the
 * messaging domain decides, and because the composer is a client component: importing it through
 * the messaging barrel would pull the API router (and the config validator with it) into the
 * browser bundle.
 */

/** Twilio's ceiling for a single concatenated SMS body. */
export const SMS_BODY_MAX_CHARS = 1600;
