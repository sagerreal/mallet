/**
 * The editable document-wording slots and their standard (default) sentences.
 *
 * Each slot names ONE line a customer document renders. An org's override lives in
 * org_settings (doc_* columns, null = never touched); these resolvers are the single
 * definition of "what does the document actually say" — override when set, otherwise the
 * exact literal the surface hardcoded before the slots existed. Every render path (the
 * public invoice page, the office preview, the tech close-out, the change-order sign
 * screen) resolves through here, so the customer's copy and the shop's copy cannot drift.
 *
 * WHAT IS DELIBERATELY NOT HERE: the quote/field-sale authorization sentence
 * (modules/quoting/domain/authorization-text.ts). That sentence is what a customer legally
 * signs, is versioned, is frozen verbatim into every signature snapshot, and its wording is
 * pending legal review — it is not org-editable, on purpose.
 *
 * Pure module: no React, no DB, no config — imported by server components, client
 * components and use-cases alike.
 */

/** Boundary caps, enforced by the updateDocuments zod input. Generous but bounded: these are
 *  document lines, not essays, and an unbounded column invites paste accidents. */
export const INVOICE_FOOTER_MAX = 500;
export const PAY_INSTRUCTIONS_MAX = 500;
export const RECEIPT_NOTE_MAX = 500;
/** Tighter than the rest: the agreement line sits directly above a signature pad and has to
 *  stay readable on a phone held out at a door. */
export const CHANGE_ORDER_AGREEMENT_MAX = 300;

/** A value worth rendering, or null — blank and whitespace both mean "use the standard". */
const present = (v: string | null | undefined): string | null => {
  const trimmed = (v ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
};

// --- Standard sentences (the pre-slot hardcoded literals, verbatim) ---------

/** The public invoice page's "how to settle this" line, shown when card payment is unavailable. */
export const defaultPayInstructions = (orgName: string): string =>
  `To pay this invoice, contact ${orgName} directly.`;

/** The public invoice page's settled-state line, under "Paid — thank you!". */
export const defaultReceiptNote = (): string =>
  "This invoice is settled in full. Keep this link for your records.";

/**
 * The sentence above the change-order signature pad. Two variants, exactly as the tech
 * builder always rendered them: a SIGNED job names the prior signature; a BOOKED job has
 * none to name.
 */
export const defaultChangeOrderAgreement = (orgName: string, signedSold: boolean): string =>
  signedSold
    ? `The customer approves adding the work listed above, at the price shown, to the job they already signed with ${orgName}. It bills with the job.`
    : `The customer approves adding the work listed above, at the price shown, to this job with ${orgName}. It bills with the job.`;

// --- Effective resolution (override ?? standard) -----------------------------

/**
 * The invoice footer is the one slot with NO standard sentence — the document never had a
 * footer, so an untouched org renders exactly what it always did: nothing.
 */
export const effectiveInvoiceFooter = (override: string | null | undefined): string | null =>
  present(override);

export const effectivePayInstructions = (
  override: string | null | undefined,
  orgName: string,
): string => present(override) ?? defaultPayInstructions(orgName);

export const effectiveReceiptNote = (override: string | null | undefined): string =>
  present(override) ?? defaultReceiptNote();

/**
 * An override applies VERBATIM to both job states — one sentence, whatever the job's
 * history. Only the standard wording distinguishes signed from booked.
 */
export const effectiveChangeOrderAgreement = (
  override: string | null | undefined,
  orgName: string,
  signedSold: boolean,
): string => present(override) ?? defaultChangeOrderAgreement(orgName, signedSold);
