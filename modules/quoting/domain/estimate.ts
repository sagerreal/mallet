import type {
  EstimateId,
  EstimateLineId,
  OrgId,
  LeadId,
  Money,
  Result,
  ValidationError,
} from "@mallet/shared/types";
import { money, zeroMoney, addMoney, validation, ok, err } from "@mallet/shared/types";
import type { SignatureDraft, SignedSnapshot } from "./signature";
import { createSignature } from "./signature";
import { authorizationText } from "./authorization-text";

const MAX_CHANGE_REQUEST_LENGTH = 2_000;

export type EstimateStatus = "draft" | "sent" | "accepted" | "declined";

export const ESTIMATE_STATUSES: readonly EstimateStatus[] = [
  "draft",
  "sent",
  "accepted",
  "declined",
];

export const isEstimateStatus = (value: string): value is EstimateStatus =>
  (ESTIMATE_STATUSES as readonly string[]).includes(value);

// Good/Better/Best. An estimate is tiered iff recommendedTier is non-null; then every line
// carries a tier tag until accept resolves the estimate to the customer's chosen tier.
export type QuoteTier = "good" | "better" | "best";

export const QUOTE_TIERS: readonly QuoteTier[] = ["good", "better", "best"];

export const isQuoteTier = (value: string): value is QuoteTier =>
  (QUOTE_TIERS as readonly string[]).includes(value);

// Customer-facing display names for the three tiers (persisted as jsonb).
export interface TierNames {
  readonly good: string;
  readonly better: string;
  readonly best: string;
}

// One tier's full money derivation — produced by the SAME rounding chain as the
// estimate-level totals (totalsFrom), never a parallel implementation.
export interface TierTotals {
  readonly subtotal: Money;
  readonly discount: Money;
  readonly net: Money;
  readonly tax: Money;
  readonly total: Money;
  readonly depositDue: Money;
}

const BPS_DENOMINATOR = 10_000; // basis points: 10000 bps = 100%

export interface EstimateLineProps {
  readonly id: EstimateLineId;
  readonly description: string;
  readonly quantity: number;
  readonly rate: Money; // price per unit, integer cents
  readonly cost: Money; // internal material/labor cost, integer cents
  readonly isOptional: boolean;
  readonly needsPhoto: boolean;
  readonly position: number;
  // Good/Better/Best tag. Null on single-format estimates and on resolved (accepted) ones.
  readonly tier: QuoteTier | null;
  /** Provenance pointer when the line came from a pricebook MATERIAL (sellable parts).
   * Values above are snapshots — the id survives for costing, never for live repricing. */
  readonly materialId: string | null;
}

// A single priced line on an estimate. Immutable value object; its extended amount is derived,
// never stored, and rounded to whole cents so totals never accumulate float drift.
export class EstimateLine {
  private constructor(private readonly p: EstimateLineProps) {}

  static create(props: EstimateLineProps): Result<EstimateLine, ValidationError> {
    const description = props.description.trim();
    if (description.length === 0) return err(validation("line description is required", "description"));
    if (props.quantity < 0) return err(validation("line quantity cannot be negative", "quantity"));
    // Quantity persists as numeric(12,2); reject any finer precision so the value used to derive
    // money is identical before and after persistence (no silent round-trip drift). Epsilon-based
    // to tolerate float representation (e.g. 0.01 * 100 !== 1 exactly).
    if (Math.abs(props.quantity * 100 - Math.round(props.quantity * 100)) > 1e-9) {
      return err(validation("line quantity supports at most 2 decimal places", "quantity"));
    }
    if (props.rate < 0) return err(validation("line rate cannot be negative", "rate"));
    if (props.cost < 0) return err(validation("line cost cannot be negative", "cost"));
    if (props.tier !== null && !isQuoteTier(props.tier)) {
      return err(validation(`unknown line tier: ${props.tier}`, "tier"));
    }
    return ok(new EstimateLine({ ...props, description }));
  }

  // Extended amount = quantity × unit rate, rounded to whole cents.
  amount(): Money {
    return money(Math.round(this.p.quantity * this.p.rate));
  }

  // Same line with the tier tag cleared — used when accept resolves a tiered estimate.
  withoutTier(): EstimateLine {
    return new EstimateLine({ ...this.p, tier: null });
  }

  get props(): EstimateLineProps {
    return this.p;
  }
}

export interface EstimateProps {
  readonly id: EstimateId;
  readonly orgId: OrgId;
  readonly num: string; // per-org human number, e.g. "EST-1042"
  readonly leadId: LeadId;
  readonly title: string | null;
  readonly status: EstimateStatus;
  readonly discBps: number; // discount %, basis points (0..10000)
  readonly taxBps: number; // tax %, basis points (>= 0)
  readonly depBps: number; // deposit %, basis points (0..10000)
  readonly depPaid: Money; // deposit expected/collected, cents (stamped on accept)
  readonly validDays: number | null;
  readonly sentAt: Date | null;
  readonly acceptedAt: Date | null;
  readonly declinedAt: Date | null;
  readonly declineReason: string | null;
  readonly changeRequestedAt: Date | null;
  readonly changeRequest: string | null;
  // Unguessable URL-safe token for the public customer quote page (no login required).
  // Set at draft-time; never changes. Null only for estimates created before the backfill migration.
  readonly publicToken: string | null;
  // Good/Better/Best: non-null recommendedTier marks the estimate as tiered. Totals derive from
  // this tier's lines until accept resolves the estimate (acceptedTier stamped, tags cleared).
  readonly recommendedTier: QuoteTier | null;
  readonly acceptedTier: QuoteTier | null;
  readonly tierNames: TierNames | null;
  // Snapshot of the selected job terms text at draft time (no live reference).
  readonly termsSnapshot: string | null;
  // Signature evidence. All nullable: an office-side acceptance has none, and that is a real state
  // rather than a missing one.
  readonly signerName?: string | null;
  readonly signatureSvg?: string | null;
  readonly signerIp?: string | null;
  readonly signerUserAgent?: string | null;
  readonly signedAt?: Date | null;
  readonly signedSnapshot?: SignedSnapshot | null;
  readonly lines: readonly EstimateLine[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// A quote for a customer. Aggregate root over its lines. All money is integer cents; percentages
// are integer basis points; every total is derived here (never stored) so there is one source of
// truth and no rounding drift. Mutations return new instances (immutability).
export class Estimate {
  private constructor(private readonly p: EstimateProps) {}

  static create(props: EstimateProps): Result<Estimate, ValidationError> {
    const num = props.num.trim();
    if (num.length === 0) return err(validation("estimate number is required", "num"));
    if (!isEstimateStatus(props.status)) {
      return err(validation(`unknown estimate status: ${props.status}`, "status"));
    }
    if (props.discBps < 0 || props.discBps > BPS_DENOMINATOR) {
      return err(validation("discount must be between 0 and 10000 bps", "discBps"));
    }
    if (props.taxBps < 0) return err(validation("tax bps cannot be negative", "taxBps"));
    if (props.depBps < 0 || props.depBps > BPS_DENOMINATOR) {
      return err(validation("deposit must be between 0 and 10000 bps", "depBps"));
    }
    const tierError = Estimate.validateTiers(props);
    if (tierError) return err(tierError);
    return ok(new Estimate({ ...props, num }));
  }

  // Tier consistency invariants. A tier may be empty while drafting (only send gates on the
  // recommended tier having a positive subtotal), but line tags must always match the format.
  private static validateTiers(props: EstimateProps): ValidationError | null {
    const { recommendedTier, acceptedTier, tierNames, lines } = props;
    if (recommendedTier !== null && !isQuoteTier(recommendedTier)) {
      return validation(`unknown recommended tier: ${recommendedTier}`, "recommendedTier");
    }
    if (acceptedTier !== null && !isQuoteTier(acceptedTier)) {
      return validation(`unknown accepted tier: ${acceptedTier}`, "acceptedTier");
    }
    if (recommendedTier === null) {
      if (acceptedTier !== null) {
        return validation("an accepted tier requires a tiered estimate", "acceptedTier");
      }
      if (tierNames !== null) {
        return validation("tier names require a tiered estimate", "tierNames");
      }
      if (lines.some((line) => line.props.tier !== null)) {
        return validation("a single-format estimate cannot carry tiered lines", "lines");
      }
      return null;
    }
    if (acceptedTier === null) {
      // Unresolved tiered estimate: EVERY line must carry a tier tag.
      if (lines.some((line) => line.props.tier === null)) {
        return validation("every line on a tiered estimate must carry a tier", "lines");
      }
    } else if (lines.some((line) => line.props.tier !== null)) {
      // Resolved (accepted) tiered estimate: lines were committed with tags cleared.
      return validation("an accepted estimate's lines must have resolved tier tags", "lines");
    }
    return Estimate.validateTierNames(tierNames);
  }

  private static validateTierNames(tierNames: TierNames | null): ValidationError | null {
    if (tierNames === null) return null;
    for (const tier of QUOTE_TIERS) {
      const name: unknown = tierNames[tier];
      // typeof guard: tierNames round-trips through jsonb — malformed rows fail loud here.
      if (typeof name !== "string" || name.trim().length === 0) {
        return validation(`tier name for "${tier}" is required`, "tierNames");
      }
    }
    return null;
  }

  // --- Pure money derivations (the prototype's calcQuote, one source of truth) ---

  // True while the estimate carries Good/Better/Best options (resolved or not).
  isTiered(): boolean {
    return this.p.recommendedTier !== null;
  }

  // All lines tagged with the given tier (fixed + optional).
  linesForTier(tier: QuoteTier): readonly EstimateLine[] {
    return this.p.lines.filter((line) => line.props.tier === tier);
  }

  // The line subset money derives from: the recommended tier pre-accept on a tiered estimate,
  // everything otherwise (single format, or resolved lines after accept).
  /**
   * The lines the customer actually bought — the scope of the sold work.
   *
   * Optional add-ons are EXCLUDED unless they were taken: an untaken add-on was priced and
   * declined, and carrying it onto the job would put work on a technician's list that nobody
   * agreed to pay for. Tiered quotes resolve to the accepted tier, so this is the one option
   * that won, not all three.
   *
   * Same source the total is computed from, so the job's scope and the job's price can never
   * describe different work.
   */
  soldLines(): readonly EstimateLine[] {
    return this.effectiveLines().filter((line) => !line.props.isOptional);
  }

  private effectiveLines(): readonly EstimateLine[] {
    if (this.p.recommendedTier === null || this.p.acceptedTier !== null) return this.p.lines;
    return this.linesForTier(this.p.recommendedTier);
  }

  // Sum of non-optional line amounts. Optional add-ons are excluded until toggled at accept.
  private static subtotalOf(lines: readonly EstimateLine[]): Money {
    return lines
      .filter((line) => !line.props.isOptional)
      .reduce((sum, line) => addMoney(sum, line.amount()), zeroMoney);
  }

  // THE rounding chain: discount on the subtotal, tax on the net, deposit on the total —
  // each step rounded to whole cents. Every total (estimate-level or per-tier) runs through
  // here so there is exactly one money implementation.
  private totalsFrom(subtotal: Money): TierTotals {
    const discount = money(Math.round((subtotal * this.p.discBps) / BPS_DENOMINATOR));
    const net = money(subtotal - discount);
    const tax = money(Math.round((net * this.p.taxBps) / BPS_DENOMINATOR));
    const total = money(net + tax);
    const depositDue = money(Math.round((total * this.p.depBps) / BPS_DENOMINATOR));
    return { subtotal, discount, net, tax, total, depositDue };
  }

  // One tier's full derivation through the shared chain (public quote picker, DTO tier totals).
  totalsForTier(tier: QuoteTier): TierTotals {
    return this.totalsFrom(Estimate.subtotalOf(this.linesForTier(tier)));
  }

  subtotal(): Money {
    return Estimate.subtotalOf(this.effectiveLines());
  }

  discountAmount(): Money {
    return this.totalsFrom(this.subtotal()).discount;
  }

  netAfterDiscount(): Money {
    return this.totalsFrom(this.subtotal()).net;
  }

  taxAmount(): Money {
    return this.totalsFrom(this.subtotal()).tax;
  }

  total(): Money {
    return this.totalsFrom(this.subtotal()).total;
  }

  depositDue(): Money {
    return this.totalsFrom(this.subtotal()).depositDue;
  }

  // --- Lifecycle ---

  canSend(): boolean {
    return this.p.status === "draft" && this.subtotal() > 0;
  }
  canAccept(): boolean {
    return this.p.status === "sent";
  }
  canDecline(): boolean {
    return this.p.status === "sent";
  }
  canRequestChange(): boolean {
    return this.p.status === "sent";
  }
  canClearChangeRequest(): boolean {
    return this.p.changeRequestedAt !== null;
  }

  // Draft → sent. Idempotent: re-sending an already-sent estimate is a no-op (same instance).
  send(now: Date): Result<Estimate, ValidationError> {
    if (this.p.status === "sent") return ok(this);
    if (!this.canSend()) {
      return err(validation("only a draft with a positive subtotal can be sent", "status"));
    }
    return ok(new Estimate({ ...this.p, status: "sent", sentAt: now, updatedAt: now }));
  }

  // Sent → accepted. Stamps the expected deposit (derived, not charged — payment is Phase 2).
  // Tiered estimates REQUIRE a chosenTier and resolve to it: only that tier's lines survive
  // (plus any already-resolved untiered lines the accept use-case committed), tags clear, and
  // acceptedTier records the choice — the accepted estimate is a single quote from here on.
  // Single-format estimates reject a chosenTier.
  /**
   * Accept, recording WHO signed and exactly what they signed.
   *
   * `signature` is optional because the office can still mark an estimate accepted itself — a
   * phone approval legitimately has no signature, and forcing one would make the office path
   * either lie or become impossible. Null means "accepted without a signature", which the UI must
   * present as a materially weaker thing than "signed" rather than conflating the two.
   */
  accept(
    now: Date,
    chosenTier?: QuoteTier,
    signature?: SignatureDraft,
    orgName?: string,
  ): Result<Estimate, ValidationError> {
    if (!this.canAccept()) return err(validation("only a sent estimate can be accepted", "status"));
    const tiered = this.p.recommendedTier !== null;
    if (tiered && !chosenTier) {
      return err(validation("a tier choice is required to accept this estimate", "chosenTier"));
    }
    if (!tiered && chosenTier) {
      return err(validation("this estimate has no tier options", "chosenTier"));
    }
    const lines =
      tiered && chosenTier
        ? this.p.lines
            .filter((line) => line.props.tier === chosenTier || line.props.tier === null)
            .map((line) => line.withoutTier())
        : this.p.lines;
    // Two-step build: depPaid derives from the RESOLVED instance so the deposit reflects the
    // chosen tier's committed lines, not the recommended tier's pre-accept subset.
    const resolved = new Estimate({
      ...this.p,
      status: "accepted",
      acceptedAt: now,
      acceptedTier: chosenTier ?? null,
      lines,
      updatedAt: now,
    });
    const priced = new Estimate({ ...resolved.p, depPaid: resolved.depositDue() });
    if (!signature) return ok(priced);

    // The snapshot is built from `priced` — the FINAL resolved state, after the tier is committed
    // and the deposit derived. Building it any earlier would freeze a document the customer never
    // saw; letting the caller supply it would let the two disagree.
    const snapshot = priced.toSignedSnapshot(orgName ?? "");
    const built = createSignature({ ...signature, signedAt: now, snapshot });
    if (!built.ok) return built;

    // Evidence is written in the SAME transition that flips the status, so an accepted estimate
    // can never exist alongside a half-written signature.
    return ok(
      new Estimate({
        ...priced.p,
        signerName: built.value.signerName,
        signatureSvg: built.value.signatureSvg,
        signerIp: built.value.signerIp,
        signerUserAgent: built.value.signerUserAgent,
        signedAt: built.value.signedAt,
        signedSnapshot: built.value.snapshot,
      }),
    );
  }

  /**
   * Freeze this estimate into the document a signature refers to.
   *
   * Reads only from `this`, so the frozen copy is by construction the same numbers the page
   * rendered — the totals come from the same methods the view calls, not a second calculation
   * that could drift from them.
   *
   * Optional lines are included with `included: false` rather than dropped: "the add-on I was
   * shown and did not take" is part of what was agreed, and a customer who later claims a service
   * was promised is answered by its presence, unticked, in the record.
   */
  toSignedSnapshot(orgName: string): SignedSnapshot {
    const total = this.total();
    const deposit = this.depositDue();
    return {
      estimateNum: this.p.num,
      lines: this.p.lines.map((l) => ({
        description: l.props.description,
        quantity: l.props.quantity,
        rateCents: l.props.rate,
        isOptional: l.props.isOptional,
        tier: l.props.tier,
        // By accept time the committed line set IS the selection, so every surviving line is in.
        included: true,
      })),
      subtotalCents: this.subtotal(),
      discountCents: this.discountAmount(),
      taxCents: this.taxAmount(),
      totalCents: total,
      depositCents: deposit,
      chosenTier: this.p.acceptedTier,
      termsText: this.p.termsSnapshot,
      authorizationText: authorizationText({
        totalCents: total,
        depositCents: deposit,
        orgName,
      }),
    };
  }

  // Sent → declined, capturing the reason.
  decline(reason: string, now: Date): Result<Estimate, ValidationError> {
    if (!this.canDecline()) return err(validation("only a sent estimate can be declined", "status"));
    return ok(
      new Estimate({
        ...this.p,
        status: "declined",
        declinedAt: now,
        declineReason: reason,
        updatedAt: now,
      }),
    );
  }

  // Customer requests a change to the sent quote. Only valid while the quote is in "sent" state.
  // Re-requesting overwrites the previous message (latest message wins). Status stays "sent" —
  // the quote is not moved to a terminal state by a change request.
  requestChange(message: string, now: Date): Result<Estimate, ValidationError> {
    if (!this.canRequestChange()) {
      return err(validation("only a sent estimate can receive a change request", "status"));
    }
    const trimmed = message.trim();
    if (trimmed.length === 0) {
      return err(validation("a change request message is required", "message"));
    }
    if (trimmed.length > MAX_CHANGE_REQUEST_LENGTH) {
      return err(validation("change request message must be 2000 characters or fewer", "message"));
    }
    return ok(
      new Estimate({
        ...this.p,
        changeRequestedAt: now,
        changeRequest: trimmed,
        updatedAt: now,
      }),
    );
  }

  // Office clears the pending change request (marks it handled). Returns the updated instance.
  clearChangeRequest(now: Date): Result<Estimate, ValidationError> {
    if (!this.p.changeRequestedAt) {
      return err(validation("no change request to clear", "changeRequest"));
    }
    return ok(new Estimate({ ...this.p, changeRequestedAt: null, changeRequest: null, updatedAt: now }));
  }

  // Replace the line set — only while still a draft (content is frozen once sent).
  withLines(lines: readonly EstimateLine[], now: Date): Result<Estimate, ValidationError> {
    if (this.p.status !== "draft") {
      return err(validation("lines can only be edited on a draft", "status"));
    }
    return ok(new Estimate({ ...this.p, lines, updatedAt: now }));
  }

  // Replace the line set unconditionally — used at accept time to commit customer-selected
  // optional add-ons before freezing the estimate. No status restriction; the caller (accept
  // use-case) is responsible for ordering (withLinesForAccept → accept).
  withLinesForAccept(lines: readonly EstimateLine[], now: Date): Estimate {
    return new Estimate({ ...this.p, lines, updatedAt: now });
  }

  get props(): EstimateProps {
    return this.p;
  }
}
