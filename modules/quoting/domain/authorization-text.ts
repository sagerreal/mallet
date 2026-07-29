/**
 * The sentence a customer actually signs.
 *
 * This exists as ONE function, in the domain, for two reasons.
 *
 * 1. It is the thing under dispute. When a customer says "I never agreed to pay that", the answer
 *    is this sentence and the amount inside it. It must not be assembled from fragments scattered
 *    across a React component, where a copy tweak could quietly change what people are agreeing to.
 *
 * 2. Wording changes over time. Every signature stores the rendered text VERBATIM in its snapshot
 *    (see SignedSnapshot.authorizationText), so a signature taken today keeps today's wording
 *    forever even after this function is edited. `AUTHORIZATION_VERSION` is stamped alongside it
 *    so a shop can tell which cohort a given signature belongs to without diffing strings.
 *
 * WORDING IS PENDING LEGAL REVIEW. The clauses below are written to be plain and truthful about
 * what the shop and the customer are each agreeing to. They are NOT drafted by an attorney, and
 * they are deliberately silent on lien rights, attorney's fees, and interest on late payment —
 * those carry state-specific requirements (in Texas, notably homestead contracts) that a template
 * cannot satisfy generically. Do not add them here without counsel.
 */

/** Bump when the wording below changes in a way that alters what is being agreed to. */
export const AUTHORIZATION_VERSION = 1;

const usd = (cents: number): string =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export interface AuthorizationTextInput {
  /** The total being authorised, in integer cents — the same number shown on the page. */
  readonly totalCents: number;
  /** Deposit due at signing, if the quote asks for one. Zero or absent means no deposit clause. */
  readonly depositCents?: number;
  /** The shop's name, so the sentence names a counterparty rather than "the contractor". */
  readonly orgName: string;
}

/**
 * Render the authorisation the customer signs.
 *
 * Three clauses, each earning its place:
 *
 *   AUTHORISE — the customer is asking for the work, which is what makes it not a gift.
 *   PAY ON COMPLETION — the clause that closes the estimate-versus-invoice gap. A shop loses the
 *     argument when the customer says they only ever signed an "estimate", so the signature says
 *     out loud that no second signature is coming and this one covers the bill.
 *   EXTRA WORK NEEDS APPROVAL — the honest other half. Saying this makes the first two clauses
 *     stronger, because the signature clearly bounds itself to a stated amount, and it is what
 *     `coveredBySignature` enforces in code rather than merely promising in prose.
 */
export function authorizationText(input: AuthorizationTextInput): string {
  const deposit =
    input.depositCents && input.depositCents > 0
      ? ` I agree to pay a deposit of ${usd(input.depositCents)} now, and the balance when the work is complete.`
      : ` I agree to pay this amount when the work is complete.`;

  return (
    `I authorize ${input.orgName} to perform the work described above for ${usd(input.totalCents)}.` +
    deposit +
    ` This approval is my signature for both the quote and the final bill for this work — ` +
    `I will not be asked to sign again for the amount shown here.` +
    ` Work beyond what is listed above is not included and needs my approval before it is done.`
  );
}
