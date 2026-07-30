import type { Result, ValidationError } from "@mallet/shared/types";
// Imported from the DOMAIN files, not the @mallet/quoting barrel. The barrel re-exports the API
// router, which pulls the config validator and throws without DB env — so a barrel import here
// would take out every unit test that touches this module. Documented in CLAUDE.md.
import { createSignature } from "../../quoting/domain/signature";
import type { SignatureDraft, SignedSnapshot } from "../../quoting/domain/signature";
import { authorizationText } from "../../quoting/domain/authorization-text";
import type { JobLine } from "./job-execution";

/**
 * The customer signing a price on the tech's device, at their kitchen table.
 *
 * This is the highest-value signing moment for a 1-3 tech shop and, until now, the one that
 * captured nothing: the field modal drew a signature on a canvas, discarded it, and told the
 * customer a copy had been texted.
 *
 * WHY THIS REUSES THE QUOTING PRIMITIVES RATHER THAN GROWING ITS OWN.
 * `createSignature` and `authorizationText` are imported, not re-implemented, so the two paths
 * cannot drift into validating differently or presenting two different sentences. A shop with one
 * signature from the web and one from the field must be able to put them side by side.
 *
 * WHERE THE TWO PATHS GENUINELY DIFFER, and it is not papered over:
 *
 *   WEB    the IP and user agent belong to the CUSTOMER's phone, reached through a link only they
 *          were sent. The device is part of the attribution.
 *   FIELD  they belong to the TECH's tablet. They attest to which device took the signature, not
 *          to who held it. What carries weight in person is the tech present as a witness (hence
 *          signedByUserId), the typed name, and the frozen price.
 *
 * Neither is stronger across the board — in person there is a human witness the web path lacks —
 * but they are different evidence and the record says which it is.
 */

export interface JobSignature {
  readonly signerName: string;
  readonly signatureSvg: string;
  readonly signerIp: string | null;
  readonly signerUserAgent: string | null;
  readonly signedAt: Date;
  readonly snapshot: SignedSnapshot;
}

export interface BuildJobSignatureInput {
  readonly draft: SignatureDraft;
  readonly lines: readonly JobLine[];
  readonly orgName: string;
  readonly signedAt: Date;
}

/**
 * Freeze the on-site price and validate the signature against it.
 *
 * The snapshot is built HERE from the JobLine value objects that are about to be written — never
 * from anything the caller supplies. A tablet that could post its own snapshot could post a $500
 * document against a $19,500 line set, and the record would look authoritative while being wrong.
 *
 * There is no deposit, tier or terms on this path: an on-site approval is the whole price, agreed
 * on the spot. Those fields are recorded as empty rather than invented so the snapshot shape stays
 * identical to the web one and a reader can tell "no deposit was taken" from "we did not capture
 * whether one was".
 */
export function buildJobSignature(input: BuildJobSignatureInput): Result<JobSignature, ValidationError> {
  const totalCents = input.lines.reduce((sum, l) => sum + lineAmountCents(l), 0);

  const snapshot: SignedSnapshot = {
    estimateNum: "",
    lines: input.lines.map((l) => ({
      description: l.props.description,
      quantity: l.props.quantity,
      rateCents: l.props.rate,
      isOptional: false,
      tier: null,
      included: true,
    })),
    subtotalCents: totalCents,
    discountCents: 0,
    // Tax on the field path is already inside the line rates the tech quoted — recording a
    // separate figure here would imply a split this flow never computed.
    taxCents: 0,
    totalCents,
    depositCents: 0,
    chosenTier: null,
    termsText: null,
    authorizationText: authorizationText({ totalCents, orgName: input.orgName }),
  };

  const built = createSignature({ ...input.draft, signedAt: input.signedAt, snapshot });
  if (!built.ok) return built;
  return {
    ok: true,
    value: {
      signerName: built.value.signerName,
      signatureSvg: built.value.signatureSvg,
      signerIp: built.value.signerIp,
      signerUserAgent: built.value.signerUserAgent,
      signedAt: built.value.signedAt,
      snapshot: built.value.snapshot,
    },
  };
}

/** Rounded per line, matching how the field modal totals them on screen. */
const lineAmountCents = (l: JobLine): number => Math.round(l.props.quantity * l.props.rate);
