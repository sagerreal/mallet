import type { Result, ValidationError } from "@mallet/shared/types";
import { ok, err, validation } from "@mallet/shared/types";

/**
 * What a shop can put in front of somebody who says "I never agreed to that".
 *
 * `acceptedAt` on its own proves that SOMEBODY HOLDING THE LINK clicked at a moment in time. It
 * names nobody, and it points at a live row that can be edited afterwards — so it says nothing
 * about the amount, which is the part that gets disputed.
 *
 * Four things are captured together because each covers a different denial:
 *
 *   "that wasn't me"            → signerName + ip + userAgent
 *   "I didn't mean to agree"    → a drawn mark, which is a deliberate act a click is not
 *   "that's not the price"      → snapshot, frozen at the moment of signing
 *   "I signed something else"   → snapshot, again — it IS the document
 *
 * NOT captured, deliberately: nothing is taken from client-supplied fields that the client could
 * lie about. The IP and user agent come off the request server-side. A client-declared IP is
 * worthless as evidence and worse than absent, because it looks like evidence.
 */

/** A single line exactly as the signer saw it. Money in integer cents, matching the DB. */
export interface SignedLine {
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly isOptional: boolean;
  readonly tier: string | null;
  /** Whether this optional line was actually selected. An unselected add-on is not part of the deal. */
  readonly included: boolean;
}

/**
 * The frozen document. Everything needed to reconstruct what was on screen, without reading a
 * single mutable row.
 */
export interface SignedSnapshot {
  readonly estimateNum: string;
  readonly lines: readonly SignedLine[];
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
  /** The deposit asked for at signing, if any — the $500 in a $20,000 job. */
  readonly depositCents: number;
  readonly chosenTier: string | null;
  /** Terms text as shown. Already snapshotted separately; repeated here so the record is self-contained. */
  readonly termsText: string | null;
  /** The exact sentence the signer agreed to, stored verbatim rather than reconstructed later. */
  readonly authorizationText: string;
}

export interface Signature {
  readonly signerName: string;
  readonly signatureSvg: string;
  readonly signerIp: string | null;
  readonly signerUserAgent: string | null;
  readonly signedAt: Date;
  readonly snapshot: SignedSnapshot;
}

/** Longest a name can be. Generous — a name is not a security boundary, only an attribution. */
const NAME_MAX = 120;
/**
 * Cap on the drawn mark. An SVG path for a signature is a few kB; anything far past that is either
 * a bug or somebody posting a payload at a public, unauthenticated endpoint.
 */
const SVG_MAX = 100_000;

export interface SignatureInput {
  readonly signerName: string;
  readonly signatureSvg: string;
  readonly signerIp: string | null;
  readonly signerUserAgent: string | null;
  readonly signedAt: Date;
  readonly snapshot: SignedSnapshot;
}

/**
 * Validate captured signature evidence.
 *
 * Both a NAME and a MARK are required. Either alone is materially weaker: a name with no mark is
 * indistinguishable from the click-to-approve this replaces, and a mark with no name attributes
 * the act to nobody. Refusing the pair is the whole point of the feature, so it refuses loudly
 * rather than storing half of it.
 */
export function createSignature(input: SignatureInput): Result<Signature, ValidationError> {
  const name = input.signerName.trim();
  if (name.length === 0) return err(validation("please type your name to sign", "signerName"));
  if (name.length > NAME_MAX) return err(validation("that name is too long", "signerName"));

  const svg = input.signatureSvg.trim();
  if (svg.length === 0) return err(validation("please draw your signature", "signatureSvg"));
  if (svg.length > SVG_MAX) return err(validation("that signature could not be read", "signatureSvg"));

  if (input.snapshot.authorizationText.trim().length === 0) {
    // A signature with no record of WHAT was agreed is the defect this feature exists to fix; it
    // must never be storable, even by a caller mistake.
    return err(validation("nothing to authorize", "authorizationText"));
  }

  return ok({
    signerName: name,
    signatureSvg: svg,
    signerIp: input.signerIp,
    signerUserAgent: input.signerUserAgent,
    signedAt: input.signedAt,
    snapshot: input.snapshot,
  });
}

/**
 * Does a final amount still fall under what was signed?
 *
 * This is the $500-deposit-then-$19,500-balance case. A signature covers the amount on the document
 * at the time. If the invoice comes in HIGHER, the excess was never authorised and is exactly the
 * part a customer can refuse with cause — so the shop needs to know before sending it, not after.
 *
 * Lower is fine: nobody disputes being charged less than they agreed to.
 */
export function coveredBySignature(snapshot: SignedSnapshot, finalTotalCents: number): boolean {
  return finalTotalCents <= snapshot.totalCents;
}
