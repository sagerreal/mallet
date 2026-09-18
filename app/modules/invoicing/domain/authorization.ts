import type { InvoiceId } from "@mallet/shared/types";

/**
 * What the customer actually authorised, and whether this bill stays inside it.
 *
 * The scenario this exists for, stated plainly: a shop quotes $20,000, the customer signs, the
 * crew adds $15,000 of work nobody signed for, and the shop sends a $35,000 invoice. The customer
 * refuses the excess WITH CAUSE. Until now Mallet was silent at every step — it would happily
 * create, edit and send that invoice — so the shop found out at collection time, months after the
 * moment when a change order could still have been signed.
 *
 * RESOLVED, NEVER COPIED. The authorisation is not duplicated onto the invoice row. It is looked
 * up through the chain the invoice already has: invoice → source job → source estimate. A copy
 * would be a third place for the signed amount to live and a third place for it to drift, and the
 * one thing an evidence trail cannot survive is two versions of the number.
 *
 * PRECEDENCE: the JOB's own signature wins over the estimate's. If a customer signed a price on
 * the tech's tablet at the kitchen table, that is the most recent thing they agreed to and it
 * supersedes whatever they approved on the web a week earlier.
 */

/** Which document carries the signature — the shop needs to be able to point at it. */
export type AuthorizationSource = "job" | "estimate";

export interface Authorization {
  readonly source: AuthorizationSource;
  readonly signerName: string;
  readonly signedAt: Date;
  /** Human reference for the document — "EST-1042", or the job number for an on-site sign-off. */
  readonly documentRef: string;
  /** The amount signed for, in integer cents. */
  readonly authorizedCents: number;
}

/**
 * The unsigned overage on an invoice, if any.
 *
 * `null` means there is nothing to warn about — either the bill is within the signed amount, or
 * nobody signed at all. Those two are NOT the same thing and the caller must not conflate them:
 * see `unsigned` below.
 */
export interface Overage {
  readonly authorizedCents: number;
  readonly invoicedCents: number;
  readonly excessCents: number;
  readonly authorization: Authorization;
}

export interface AuthorizationCheck {
  readonly invoiceId: InvoiceId;
  /** Null when no signature governs this invoice — an unsigned job billed directly. */
  readonly authorization: Authorization | null;
  /** Set only when an authorisation exists AND the bill exceeds it. */
  readonly overage: Overage | null;
}

export interface CheckAuthorizationInput {
  readonly invoiceId: InvoiceId;
  readonly invoiceTotalCents: number;
  readonly authorization: Authorization | null;
}

/**
 * Compare a bill against what was signed.
 *
 * Deliberately NOT a boolean. Three states matter and collapsing them loses the one that counts:
 *
 *   signed, within      → nothing to say
 *   signed, over        → an overage the shop should resolve BEFORE sending
 *   never signed        → no warning, because there is no signed amount to exceed. Warning here
 *                         would train people to dismiss the banner, and the banner only works if
 *                         it is rare and always means something.
 *
 * Equal is fine. Lower is fine — nobody disputes being charged less than they agreed to.
 */
export function checkAuthorization(input: CheckAuthorizationInput): AuthorizationCheck {
  const auth = input.authorization;
  if (!auth) return { invoiceId: input.invoiceId, authorization: null, overage: null };

  const excessCents = input.invoiceTotalCents - auth.authorizedCents;
  if (excessCents <= 0) {
    return { invoiceId: input.invoiceId, authorization: auth, overage: null };
  }
  return {
    invoiceId: input.invoiceId,
    authorization: auth,
    overage: {
      authorizedCents: auth.authorizedCents,
      invoicedCents: input.invoiceTotalCents,
      excessCents,
      authorization: auth,
    },
  };
}

/**
 * Pick the governing authorisation from what the chain turned up.
 *
 * The job's own signature wins — see the precedence note above. Passing both is normal: a quote
 * signed on the web that later got a price change signed on site has two, and only the later one
 * describes what the customer currently agrees to owe.
 */
/**
 * Fold every signed CHANGE ORDER into the governing authorisation.
 *
 * A job's authorised amount is not one number on one document — it is the original signature plus
 * everything the customer has since agreed to in writing. Without this, finding more work on site,
 * pricing it, and having the customer sign for it still produced an invoice flagged as exceeding
 * what was authorised: the app could say "this bill is $2,400 over" but had no way to record that
 * they had agreed to the extra. The warning was therefore worthless — it fired on legitimate work
 * as readily as on unauthorised work, which is how a warning gets ignored.
 *
 * The base document stays the one on record (a shop chasing a dispute wants the original), while
 * `authorizedCents` becomes the total actually agreed. Change orders WITHOUT a signature are
 * excluded — an unsigned add-on is precisely the thing the overage warning exists to catch.
 */
export function withChangeOrders(
  base: Authorization | null,
  changeOrders: readonly Authorization[],
): Authorization | null {
  const signed = changeOrders.filter((c) => c.signerName.trim().length > 0);
  if (!base) {
    // No original signature. Signed add-ons alone do not authorise the base work — they authorise
    // themselves — so there is still nothing governing the invoice as a whole.
    return signed.length === 0 ? null : null;
  }
  if (signed.length === 0) return base;
  return {
    ...base,
    authorizedCents: signed.reduce((sum, c) => sum + c.authorizedCents, base.authorizedCents),
  };
}

export function resolveAuthorization(
  jobSignature: Authorization | null,
  estimateSignature: Authorization | null,
): Authorization | null {
  return jobSignature ?? estimateSignature ?? null;
}
