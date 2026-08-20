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
 *   "that wasn't me"            → signerName + ip + userAgent + the per-quote token
 *   "I didn't mean to agree"    → the authorization text, typed name, and (optionally) a mark
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
  /** Scope prose shown under the line, part of what the signer read. Optional: snapshots taken
   *  before scope existed simply have none. */
  readonly scope?: string | null;
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
  /** Which numbers the signer's page showed ('lines' | 'total'). Optional: older snapshots
   *  predate the display switch and always showed every amount. */
  readonly priceDisplay?: string;
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
 * Everything a signature needs EXCEPT the snapshot.
 *
 * The split matters. A caller supplies who signed and what they drew; only the estimate can say
 * what the document was. If a route could hand over both halves, the two could disagree — a
 * snapshot claiming $500 attached to a $19,500 estimate — and the record would be worse than
 * useless, because it would look authoritative while being wrong.
 *
 * So the estimate builds its own snapshot from its own resolved state at the moment of accepting,
 * and this is the only part that crosses the wire. The invariant is structural, not a rule someone
 * has to remember.
 *
 * `signerIp` and `signerUserAgent` are read off the request server-side and are NOT client fields.
 */
export interface SignatureDraft {
  readonly signerName: string;
  readonly signatureSvg: string;
  readonly signerIp: string | null;
  readonly signerUserAgent: string | null;
}

/**
 * Validate captured signature evidence.
 *
 * The TYPED NAME is required. The DRAWN MARK is optional.
 *
 * That split is deliberate and it is the opposite of the intuitive one, so it is worth writing
 * down why. Texas law is unusually clear on both halves:
 *
 *   The typed name is a real signature. Aerotek, Inc. v. Boyd, 624 S.W.3d 199 (Tex. 2021), slip
 *   op. 13-14, rejected the argument that a printed name "cannot qualify as a signature of any
 *   kind", and fn. 34 restates the long-standing rule that "to sign, in the primary sense of the
 *   word, is to make any mark". Tex. Bus. & Com. Code §322.002(8) turns on intent, not on form.
 *
 *   The drawn mark is the one method the court expressly refused to rule on. Aerotek fn. 22:
 *   "We express no opinion on how to authenticate a handwritten signature created electronically
 *   with a stylus, finger, or mouse." The court's reasoning at slip op. 9 is that the ordinary
 *   ways of proving a handwritten signature — an eyewitness, someone who knows the handwriting,
 *   an expert comparing a genuine specimen — do not carry over, and a finger squiggle on a phone
 *   is not a handwriting exemplar in any case.
 *
 * So requiring the drawing would have gated every approval on the weakest piece of evidence in
 * the record, and would have locked out anyone who cannot use a pointer at all. It is kept
 * because customers expect it and the act of drawing reads as deliberate — but it sits on top of
 * the load-bearing evidence rather than being it.
 *
 * What actually carries the weight is the combination the rest of this record captures: the typed
 * name, the unguessable per-quote token, the IP and user agent, the timestamp, and the frozen
 * snapshot of what was on screen.
 *
 * NOT LEGAL ADVICE, and none of the above is a promise of enforceability — ESIGN §7001(a) and
 * §322.007 only stop a record being rejected SOLELY for being electronic. See docs.
 */
export function createSignature(input: SignatureInput): Result<Signature, ValidationError> {
  const name = input.signerName.trim();
  if (name.length === 0) return err(validation("please type your name to sign", "signerName"));
  if (name.length > NAME_MAX) return err(validation("that name is too long", "signerName"));

  const svg = input.signatureSvg.trim();
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
