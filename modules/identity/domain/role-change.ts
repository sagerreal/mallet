/**
 * modules/identity/domain/role-change.ts
 *
 * The sentence behind the one role-change rule a user has to read.
 *
 * It lives here, not inline in the router, because it is the only thing the person on the other
 * end ever sees. Settings rendered `err.message` straight out of the transport, so the refusal
 * read as "cannot remove the last owner" — a lowercase fragment with no next step, which is what a
 * log line looks like, not an answer.
 *
 * The router's OTHER refusal ("only an owner can change owner roles") stays a fragment on purpose:
 * it is a genuine FORBIDDEN, and the client's fixed copy for that code already says the true and
 * complete thing ("Your role can't do that"), so no server wording of it is ever shown.
 */

/**
 * Refusing to demote the only owner. A CONFLICT, not a FORBIDDEN: the person asking is allowed to
 * change roles — the org is what cannot be left ownerless — and FORBIDDEN maps client-side to
 * "Your role can't do that", which would send an owner looking for a permission they already have.
 */
export const LAST_OWNER_REFUSAL =
  "This is the only owner. Make someone else an owner first, then change this role.";
