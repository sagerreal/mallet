import type {
  EstimateId,
  EstimateLineId,
  EstimateSectionId,
  OrgId,
  LeadId,
  Money,
  Result,
  ValidationError,
} from "@mallet/shared/types";
import type { PricingRates, PricedTotals } from "@mallet/shared/types";
import {
  money,
  zeroMoney,
  addMoney,
  validation,
  ok,
  err,
  deriveTotals,
  ZERO_RATES,
  BPS_DENOMINATOR,
} from "@mallet/shared/types";
import type { SignatureDraft, SignedSnapshot } from "./signature";
import { createSignature } from "./signature";
import { authorizationText } from "./authorization-text";
import { evaluateQuantityExpression, MAX_QTY_EXPR_LENGTH } from "./quantity-expression";
import { EstimateSection, orderSections } from "./estimate-section";
import { EstimateJobCost, jobCostTotalCents } from "./estimate-job-cost";
// The proposal snapshot moved to its own file when it grew a document mode, a design, cover
// meta and photos. Re-exported here so every existing import site is unchanged.
import { validatePresentationSnapshot } from "./presentation-snapshot";
import type { PresentationSnapshot } from "./presentation-snapshot";
export {
  PRESENTATION_PAGE_KEYS,
  PRESENTATION_MODES,
  PRESENTATION_FONTS,
  validatePresentationSnapshot,
  photoKeysIn,
} from "./presentation-snapshot";
export type {
  PresentationPageKey,
  PresentationMode,
  PresentationFont,
  PresentationSnapshot,
  PresentationPage,
  PresentationPhoto,
  PresentationDesign,
  PresentationMeta,
} from "./presentation-snapshot";

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

/**
 * Where the quote was born. 'office' = the ordinary draft→send→accept path. 'field' = priced and
 * signed ON SITE (v1.field.signQuote) — born accepted, carrying the on-glass signature evidence.
 * Write-once provenance: an estimate never changes origin.
 */
export type EstimateOrigin = "office" | "field";

export const ESTIMATE_ORIGINS: readonly EstimateOrigin[] = ["office", "field"];

export const isEstimateOrigin = (value: string): value is EstimateOrigin =>
  (ESTIMATE_ORIGINS as readonly string[]).includes(value);

/**
 * Which numbers the customer sees on the public quote. 'lines' = per-line extended amounts
 * (today's behavior); 'total' = scope prose + one price at the bottom (the proposal format).
 * Display-only: rates stay in the data either way, and optional add-on prices always show —
 * adding one changes the total, so its price must be visible.
 */
export type PriceDisplay = "lines" | "total";

export const PRICE_DISPLAYS: readonly PriceDisplay[] = ["lines", "total"];

export const isPriceDisplay = (value: string): value is PriceDisplay =>
  (PRICE_DISPLAYS as readonly string[]).includes(value);

/**
 * One row of the estimating math behind a line — the substrate model (Cabinet Doors × 22,
 * Walls × 2,400 sq ft) whose amounts the composer rolls up into the line's rate. Internal only:
 * never serialized to a customer-facing surface, exactly like cost. The line's rate stays the
 * single pricing source of truth — the sum is a composer affordance, never a server invariant,
 * so an owner can always override the rolled-up price.
 */
export interface EstimateSubItem {
  readonly description: string;
  readonly quantity: number;
  readonly unit: string | null;
  readonly amountCents: number;
}

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
// estimate-level totals (deriveTotals), never a parallel implementation.
export type TierTotals = PricedTotals;

export interface EstimateLineProps {
  readonly id: EstimateLineId;
  readonly description: string;
  readonly quantity: number;
  readonly rate: Money; // price per unit, integer cents
  readonly cost: Money; // internal material/labor cost, integer cents
  readonly isOptional: boolean;
  readonly needsPhoto: boolean;
  /**
   * Does this line take sales tax. Seeded from the pricebook item/material it came from and
   * overridable per line — the model Housecall Pro and Jobber both use.
   *
   * A SECOND, DIFFERENT filter from `isOptional`. A non-taxable line still counts toward the
   * subtotal and the total; it just does not feed the tax base. Conflating the two would drop
   * the line's price off the bill entirely.
   */
  readonly taxable: boolean;
  readonly position: number;
  // Good/Better/Best tag. Null on single-format estimates and on resolved (accepted) ones.
  readonly tier: QuoteTier | null;
  /** Provenance pointer when the line came from a pricebook MATERIAL (sellable parts).
   * Values above are snapshots — the id survives for costing, never for live repricing. */
  readonly materialId: string | null;
  /** Customer-facing scope prose under this line (Includes / Excludes / Prep / Products), plain
   *  text rendered pre-wrap. Optional so pre-existing construction sites read as null. */
  readonly scope?: string | null;
  /** Internal estimating math behind the price — see EstimateSubItem. Null when the line was
   *  priced directly. Optional for the same reason as scope. */
  readonly subItems?: readonly EstimateSubItem[] | null;
  /** What the quantity is counted in — "LF", "hr", "bags". Display only: it never enters the
   *  money math, it tells the customer what they are buying 100 of. */
  readonly unit?: string | null;
  /**
   * The typed math behind `quantity`, when the estimator authored one ("qty/8+1"). `quantity`
   * stays the resolved number every total and every downstream surface reads; this is only how
   * it was authored. create() re-evaluates it, so the two can never disagree in the database.
   */
  readonly qtyExpr?: string | null;
  /** Round the resolved quantity up to a whole unit — you cannot buy half a post. */
  readonly roundUp?: boolean;
  /** The line this one is a component of, for an assembly. Null on an ordinary line. */
  readonly parentLineId?: EstimateLineId | null;
  /** The named group this line sits under. Null when ungrouped. */
  readonly sectionId?: string | null;
  /** Does the customer see this line at all. Distinct from isOptional (visible AND choosable). */
  readonly customerVisible?: boolean;
  /** Markup over cost in basis points when the line is priced from its cost; null = hand-priced. */
  readonly markupBps?: number | null;
  /** What kind of cost this is — material/labor/equipment/subcontract/other. Office-side. */
  readonly lineType?: LineType | null;
  /** Photos attached to the line — office reference material, never on the customer copy. */
  readonly attachments?: readonly LineAttachment[] | null;
}

export const MAX_LINE_ATTACHMENTS = 8;

/** The cost vocabulary a line can be tagged with. Closed here; text in the column. */
export const LINE_TYPES = ["material", "labor", "equipment", "subcontract", "other"] as const;
export type LineType = (typeof LINE_TYPES)[number];

export interface LineAttachment {
  /** A key into the org's proposal-photo storage (the upload path validates its shape). */
  readonly key: string;
  /** The name it was attached under — what the office reads in the list. */
  readonly name: string;
}

/**
 * What `EstimateLine.create` accepts. Identical to the props except `taxable` may be omitted,
 * in which case it reads as TRUE.
 *
 * The default is the column's (`estimate_lines.taxable NOT NULL DEFAULT true`) and means the same
 * thing: every line written before taxability existed was summed into a tax base with no
 * exclusions, so `true` is what those rows already were. Defaulting to `false` would silently
 * rebase every live quote to $0.00 tax.
 */
export type EstimateLineCreateProps = Omit<EstimateLineProps, "taxable"> & {
  readonly taxable?: boolean;
  /**
   * The parent's quantity, supplied only so create() can check a child's expression against the
   * quantity being stored. Never kept on the line — the parent is the one place it lives.
   */
  readonly driverQuantity?: number | null;
};

// Scope is a proposal page's worth of prose, not a paragraph cap — the PaintScout exemplar runs
// ~2.5 printed pages for one line. Sub-item bounds mirror the composer's editable rows.
const MAX_SCOPE_CHARS = 8000;
const MAX_SUB_ITEMS = 20;
const MAX_SUB_DESCRIPTION_CHARS = 500;
const MAX_SUB_UNIT_CHARS = 20;
const MAX_UNIT_CHARS = 20;

// Jsonb round-trip validation for a line's sub-items — malformed rows fail loud, valid input is
// normalized (trimmed, blank unit → null) and frozen. Absent/empty reads as null, one meaning.
const validateSubItems = (
  input: readonly EstimateSubItem[] | null | undefined,
): Result<readonly EstimateSubItem[] | null, ValidationError> => {
  if (input == null || input.length === 0) return ok(null);
  if (input.length > MAX_SUB_ITEMS) {
    return err(validation(`a line is limited to ${MAX_SUB_ITEMS} sub-items`, "subItems"));
  }
  const items: EstimateSubItem[] = [];
  for (const item of input) {
    const description = typeof item.description === "string" ? item.description.trim() : "";
    if (description.length === 0 || description.length > MAX_SUB_DESCRIPTION_CHARS) {
      return err(validation("sub-item description is required (max 500 chars)", "subItems"));
    }
    if (!Number.isFinite(item.quantity) || item.quantity < 0) {
      return err(validation("sub-item quantity cannot be negative", "subItems"));
    }
    const unitRaw = typeof item.unit === "string" ? item.unit.trim() : "";
    if (unitRaw.length > MAX_SUB_UNIT_CHARS) {
      return err(validation("sub-item unit is limited to 20 characters", "subItems"));
    }
    if (!Number.isInteger(item.amountCents) || item.amountCents < 0) {
      return err(validation("sub-item amount must be non-negative integer cents", "subItems"));
    }
    items.push({
      description,
      quantity: item.quantity,
      unit: unitRaw.length === 0 ? null : unitRaw,
      amountCents: item.amountCents,
    });
  }
  return ok(Object.freeze(items));
};

// A single priced line on an estimate. Immutable value object; its extended amount is derived,
// never stored, and rounded to whole cents so totals never accumulate float drift.
export class EstimateLine {
  private constructor(private readonly p: EstimateLineProps) {}

  static create(props: EstimateLineCreateProps): Result<EstimateLine, ValidationError> {
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
    const scopeTrimmed = typeof props.scope === "string" ? props.scope.trim() : null;
    if (scopeTrimmed !== null && scopeTrimmed.length > MAX_SCOPE_CHARS) {
      return err(validation(`scope is limited to ${MAX_SCOPE_CHARS} characters`, "scope"));
    }
    const subItems = validateSubItems(props.subItems);
    if (!subItems.ok) return subItems;

    const unitTrimmed = typeof props.unit === "string" ? props.unit.trim() : null;
    if (unitTrimmed !== null && unitTrimmed.length > MAX_UNIT_CHARS) {
      return err(validation(`unit is limited to ${MAX_UNIT_CHARS} characters`, "unit"));
    }

    const exprTrimmed = typeof props.qtyExpr === "string" ? props.qtyExpr.trim() : null;
    const qtyExpr = exprTrimmed !== null && exprTrimmed.length > 0 ? exprTrimmed : null;
    if (qtyExpr !== null) {
      if (qtyExpr.length > MAX_QTY_EXPR_LENGTH) {
        return err(validation(`quantity math is limited to ${MAX_QTY_EXPR_LENGTH} characters`, "qtyExpr"));
      }
      // Reconcile ONLY when the caller supplies the driver — which the write path does and
      // read-back cannot. On write, the stored quantity must be what this expression produces:
      // anything else means the client computed something the server would not, and the money
      // would follow the wrong one. On read there is no parent row to evaluate against, so the
      // stored quantity stands; re-deriving it there would make every saved component of an
      // assembly unreadable the moment its expression referenced a driver we no longer have.
      if (props.driverQuantity != null) {
        const evaluated = evaluateQuantityExpression(qtyExpr, props.driverQuantity, unitTrimmed);
        if (!evaluated.ok) return evaluated;
        const resolved = props.roundUp ? Math.ceil(evaluated.value) : evaluated.value;
        if (Math.abs(resolved - props.quantity) > 1e-9) {
          return err(
            validation(
              `line quantity ${props.quantity} does not match its own math (${qtyExpr} = ${resolved})`,
              "quantity",
            ),
          );
        }
      }
    }

    if (props.parentLineId != null && props.parentLineId === props.id) {
      return err(validation("a line cannot be its own parent", "parentLineId"));
    }

    if (props.markupBps != null) {
      if (props.markupBps < 0) return err(validation("markup cannot be negative", "markupBps"));
      if (!Number.isInteger(props.markupBps)) {
        return err(validation("markup is whole basis points", "markupBps"));
      }
    }

    if (props.lineType != null && !LINE_TYPES.includes(props.lineType)) {
      return err(validation("unknown line type", "lineType"));
    }
    if (props.attachments != null) {
      if (props.attachments.length > MAX_LINE_ATTACHMENTS) {
        return err(validation(`a line holds at most ${MAX_LINE_ATTACHMENTS} attachments`, "attachments"));
      }
      for (const a of props.attachments) {
        if (!a.key.trim() || !a.name.trim()) {
          return err(validation("an attachment needs a key and a name", "attachments"));
        }
      }
    }

    return ok(
      new EstimateLine({
        ...props,
        description,
        taxable: props.taxable ?? true,
        scope: scopeTrimmed !== null && scopeTrimmed.length > 0 ? scopeTrimmed : null,
        subItems: subItems.value,
        unit: unitTrimmed !== null && unitTrimmed.length > 0 ? unitTrimmed : null,
        qtyExpr,
        roundUp: props.roundUp ?? false,
        parentLineId: props.parentLineId ?? null,
        sectionId: props.sectionId ?? null,
        customerVisible: props.customerVisible ?? true,
        markupBps: props.markupBps ?? null,
        lineType: props.lineType ?? null,
        attachments: props.attachments && props.attachments.length > 0 ? props.attachments : null,
      }),
    );
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
  /** Provenance — see EstimateOrigin. Optional so pre-existing construction sites read as the
   *  historical default ('office'); absent means office, never "unknown". */
  readonly origin?: EstimateOrigin;
  readonly discBps: number; // discount %, basis points (0..10000)
  readonly taxBps: number; // tax %, basis points (>= 0)
  readonly depBps: number; // deposit %, basis points (0..10000)
  readonly depPaid: Money; // deposit expected/collected, cents (stamped on accept)
  readonly validDays: number | null;
  readonly sentAt: Date | null;
  /** Is the shop still chasing this quote, and how many nudges in. Was client-local, and the
   *  hydrator reset it to off on every refetch — so a toggle switched ON read back OFF. */
  readonly followUpOn?: boolean;
  readonly followUpStage?: number;
  readonly acceptedAt: Date | null;
  readonly declinedAt: Date | null;
  readonly declineReason: string | null;
  readonly changeRequestedAt: Date | null;
  /**
   * The job this quote adds work to — a CHANGE ORDER. Null on an ordinary quote.
   *
   * Set when more work was found on a job already running. It is still a quote in every other
   * respect: it is priced, sent, and SIGNED the same way. That is the point — the customer agrees
   * to the extra in the same manner they agreed to the original, so the invoice can prove it.
   */
  readonly changeOrderForJobId: string | null;
  /**
   * The scope-visit job this quote prices — the walkthrough that produced it. Null on a quote
   * with no visit behind it.
   *
   * Set at draft time (the composer arrives from the pipeline's scoped card carrying the job).
   * At accept, the job-creation path CONVERTS this job into the sold work instead of minting a
   * second one — the walkthrough, the quote and the work stay one thread, not two jobs for one
   * sale. Distinct from changeOrderForJobId, which points at RUNNING work the quote adds to.
   */
  readonly jobId: string | null;
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
  /** Which numbers the customer sees — see PriceDisplay. Optional so pre-existing construction
   *  sites read as the historical default ('lines'); absent means lines, never "unknown". */
  readonly priceDisplay?: PriceDisplay;
  /** The designed pages frozen at draft time — null/absent on a plain quote (the default). */
  readonly presentationSnapshot?: PresentationSnapshot | null;
  // Signature evidence. All nullable: an office-side acceptance has none, and that is a real state
  // rather than a missing one.
  readonly signerName?: string | null;
  readonly signatureSvg?: string | null;
  readonly signerIp?: string | null;
  readonly signerUserAgent?: string | null;
  readonly signedAt?: Date | null;
  readonly signedSnapshot?: SignedSnapshot | null;
  readonly lines: readonly EstimateLine[];
  /**
   * Named groups the lines sit under. Optional so every pre-existing construction site reads as
   * the historical default — an UNGROUPED estimate, which is still the common one. A line names
   * its section; the sections themselves hold no lines and no money.
   */
  readonly sections?: readonly EstimateSection[];
  /**
   * What the job costs beyond the quote's own lines — a permit, a dumpster, a placed purchase
   * order. Optional, so every construction site that predates them is unchanged. These NEVER
   * enter any customer-facing number; see jobCostTotal.
   */
  readonly jobCosts?: readonly EstimateJobCost[];
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
    if (props.origin !== undefined && !isEstimateOrigin(props.origin)) {
      return err(validation(`unknown estimate origin: ${props.origin}`, "origin"));
    }
    if (props.priceDisplay !== undefined && !isPriceDisplay(props.priceDisplay)) {
      return err(validation(`unknown price display: ${props.priceDisplay}`, "priceDisplay"));
    }
    const presentation = validatePresentationSnapshot(props.presentationSnapshot);
    if (!presentation.ok) return presentation;
    if (props.discBps < 0 || props.discBps > BPS_DENOMINATOR) {
      return err(validation("discount must be between 0 and 10000 bps", "discBps"));
    }
    if (props.taxBps < 0) return err(validation("tax bps cannot be negative", "taxBps"));
    if (props.depBps < 0 || props.depBps > BPS_DENOMINATOR) {
      return err(validation("deposit must be between 0 and 10000 bps", "depBps"));
    }
    const tierError = Estimate.validateTiers(props);
    if (tierError) return err(tierError);
    const sectionError = Estimate.validateSections(props);
    if (sectionError) return err(sectionError);
    return ok(new Estimate({ ...props, num, presentationSnapshot: presentation.value }));
  }

  /**
   * Sections are referential integrity and nothing else: no duplicate ids, and no line pointing
   * at a group that is not here. A dangling sectionId would render a line under a heading that
   * does not exist — it would simply vanish from the customer's copy.
   */
  private static validateSections(props: EstimateProps): ValidationError | null {
    const sections = props.sections ?? [];
    const ids = new Set<string>();
    for (const section of sections) {
      if (ids.has(section.id)) {
        return validation(`duplicate section: ${section.id}`, "sections");
      }
      ids.add(section.id);
    }
    for (const line of props.lines) {
      const sectionId = line.props.sectionId;
      if (sectionId !== null && sectionId !== undefined && !ids.has(sectionId)) {
        return validation(`line references a section that is not on this estimate: ${sectionId}`, "sectionId");
      }
    }
    return null;
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

  /**
   * The lines money derives from, and the scope handed to the job.
   *
   * Components are dropped here as well as inside the two sums: this is also what `soldLines`
   * reads, and "Line posts, 4×4×8 cedar" is a part the shop buys, not work on a technician's
   * list. The customer bought the fence.
   */
  private effectiveLines(): readonly EstimateLine[] {
    const quoted = this.p.lines.filter(Estimate.contributesMoney);
    if (this.p.recommendedTier === null || this.p.acceptedTier !== null) return quoted;
    return quoted.filter((line) => line.props.tier === this.p.recommendedTier);
  }

  /**
   * Does this line put money on the bill at all.
   *
   * A COMPONENT does not: its money is already inside its parent, whose rate IS the roll-up of
   * the parts beneath it. Counting both bills the customer twice for the same fence — a $1,158
   * assembly charged as $2,316. This sits beside `isOptional` because it answers the same kind
   * of question, and every derivation below runs through one of the two sums that use it.
   */
  private static contributesMoney(line: EstimateLine): boolean {
    return !line.props.parentLineId;
  }

  // Sum of non-optional line amounts. Optional add-ons are excluded until toggled at accept.
  private static subtotalOf(lines: readonly EstimateLine[]): Money {
    return lines
      .filter((line) => !line.props.isOptional && Estimate.contributesMoney(line))
      .reduce((sum, line) => addMoney(sum, line.amount()), zeroMoney);
  }

  /**
   * The money the shop's rate is actually charged on: TAXABLE and NON-OPTIONAL lines.
   *
   * Two filters, not one. `isOptional` decides whether the line is on the bill at all;
   * `taxable` decides whether the line feeds the tax. A non-taxable line is still sold, still
   * in the subtotal, still in the total — it simply does not attract tax. Folding taxability
   * into subtotalOf would delete the line's price from the customer's bill.
   */
  private static taxableBaseOf(lines: readonly EstimateLine[]): Money {
    return lines
      .filter((line) => !line.props.isOptional && line.props.taxable && Estimate.contributesMoney(line))
      .reduce((sum, line) => addMoney(sum, line.amount()), zeroMoney);
  }

  /** This estimate's three rates, as the shared chain takes them. */
  rates(): PricingRates {
    return { discBps: this.p.discBps, taxBps: this.p.taxBps, depBps: this.p.depBps };
  }

  // THE rounding chain: discount on the subtotal, tax on the discounted taxable base, deposit
  // on the total — each step rounded to whole cents. Delegated to deriveTotals so the quote, the
  // on-glass signature snapshot and the invoice cannot drift into three different answers; the
  // order and the rounding are documented there.
  private totalsFrom(subtotal: Money, taxableBase: Money): TierTotals {
    return deriveTotals(subtotal, taxableBase, this.rates());
  }

  // A line set's full derivation. The ONE place subtotal and taxable base are paired, so a
  // caller can never hand the chain a base that belongs to different lines than the subtotal.
  private totalsForLines(lines: readonly EstimateLine[]): TierTotals {
    return this.totalsFrom(Estimate.subtotalOf(lines), Estimate.taxableBaseOf(lines));
  }

  // One tier's full derivation through the shared chain (public quote picker, DTO tier totals).
  totalsForTier(tier: QuoteTier): TierTotals {
    return this.totalsForLines(this.linesForTier(tier));
  }

  subtotal(): Money {
    return Estimate.subtotalOf(this.effectiveLines());
  }

  /** Σ(taxable, non-optional) — what taxBps is charged on, before the discount comes off it. */
  taxableBase(): Money {
    return Estimate.taxableBaseOf(this.effectiveLines());
  }

  discountAmount(): Money {
    return this.totalsForLines(this.effectiveLines()).discount;
  }

  netAfterDiscount(): Money {
    return this.totalsForLines(this.effectiveLines()).net;
  }

  taxAmount(): Money {
    return this.totalsForLines(this.effectiveLines()).tax;
  }

  total(): Money {
    return this.totalsForLines(this.effectiveLines()).total;
  }

  depositDue(): Money {
    return this.totalsForLines(this.effectiveLines()).depositDue;
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
    // depPaid is deliberately NOT stamped here. Accepting a quote is an agreement, not a
    // payment — the deposit ask stays the depositDue() derivation, and depPaid moves only when
    // money actually lands (recorded by the payment path). Stamping it at accept faked a paid
    // deposit onto every accepted quote and credited invoices with cash nobody had collected.
    const priced = new Estimate({
      ...this.p,
      status: "accepted",
      acceptedAt: now,
      acceptedTier: chosenTier ?? null,
      lines,
      updatedAt: now,
    });
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
   * Carry the deposit total that has actually been COLLECTED on this quote.
   *
   * The counterpart to what accept() deliberately does not do: accepting is an agreement, this is
   * money landing. Only an accepted quote can hold a deposit — crediting one against a draft or a
   * declined quote would net money off a future invoice for a sale that was never made.
   *
   * `totalCents` is the SUM of the quote's deposit-ledger rows, not one payment: the ledger
   * (estimate_deposits, keyed on the settling payment_intent id) is the record of what was paid,
   * and `depPaid` is only its cached total. That is why this replaces rather than adds — adding a
   * per-payment amount here would double-count the redelivery of a single payment, and replacing
   * with a per-payment amount would erase the first of two real ones. Neither question can be
   * answered without payment identity, and identity lives in the ledger.
   *
   * Not clamped to depositDue(): a customer who paid more than the ask has still paid it, and
   * discarding the difference would put the shop's books out by the overpayment.
   */
  withDepositPaid(totalCents: number, now: Date): Result<Estimate, ValidationError> {
    if (this.p.status !== "accepted") {
      return err(validation("only an accepted estimate can take a deposit", "status"));
    }
    if (!Number.isFinite(totalCents) || totalCents <= 0) {
      return err(validation("a deposit must be a positive amount", "totalCents"));
    }
    return ok(
      new Estimate({
        ...this.p,
        depPaid: money(Math.round(totalCents)),
        updatedAt: now,
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
        // Scope is part of what the signer read — the record is incomplete without it.
        scope: l.props.scope ?? null,
        // By accept time the committed line set IS the selection, so every surviving line is in.
        included: true,
      })),
      subtotalCents: this.subtotal(),
      discountCents: this.discountAmount(),
      taxCents: this.taxAmount(),
      totalCents: total,
      depositCents: deposit,
      chosenTier: this.p.acceptedTier,
      // What the signer's page showed per line: every amount, or scope + one total.
      priceDisplay: this.priceDisplay(),
      termsText: this.p.termsSnapshot,
      authorizationText: authorizationText({
        totalCents: total,
        depositCents: deposit,
        orgName,
      }),
    };
  }

  /** Provenance, defaulting the pre-column history to 'office'. */
  origin(): EstimateOrigin {
    return this.p.origin ?? "office";
  }

  // Absent means the historical default: per-line amounts, exactly what every quote showed
  // before the display switch existed.
  priceDisplay(): PriceDisplay {
    return this.p.priceDisplay ?? "lines";
  }

  /**
   * A sale closed ON SITE: the quote is born ACCEPTED, with the customer's signature taken in the
   * same construction — there is no moment where a field-born estimate exists unsigned.
   *
   * This is the record behind v1.field.signQuote. The tech prices the work on the tablet and the
   * customer signs there; draft→send→accept never happened, so forcing the aggregate through those
   * transitions would fabricate a history nobody lived. Instead the estimate starts at the end
   * state, and `origin: "field"` says so honestly. sentAt is stamped too: presenting the tablet IS
   * the presentation, and downstream reads treat sentAt as "when the customer first saw it".
   *
   * `rates` carries the discount, tax and deposit the TECH set at the door, and defaults to none.
   * It used to be hard-coded to zero, which meant a technician standing in a customer's kitchen
   * could not knock anything off, could not charge the sales tax his shop is legally collecting,
   * and could not ask for a deposit — all three of which the office composer has always had. The
   * default keeps every field sale taken before this shipped reading exactly as it did: no rates,
   * so total === subtotal, bit-for-bit.
   *
   * Whatever is passed here is what the customer signs: `withOnSiteSignature` freezes the snapshot
   * from THIS estimate, so the authorised figure is the tax-inclusive total these rates produce.
   */
  static sellOnSite(args: {
    readonly id: EstimateId;
    readonly orgId: OrgId;
    readonly num: string;
    readonly leadId: LeadId;
    readonly title: string | null;
    readonly lines: readonly EstimateLine[];
    readonly publicToken: string | null;
    readonly signature: SignatureDraft;
    readonly orgName: string;
    readonly now: Date;
    /**
     * Set when this on-site sale is an ADDENDUM to work already running — found work the customer
     * signed for at the door. Absent on an ordinary field sale (the whole job was sold on site).
     *
     * It is what makes the invoicing module's overage check tell legitimate extra work apart from
     * work nobody agreed to: `withChangeOrders` folds every SIGNED estimate carrying this pointer
     * into the job's authorised amount.
     */
    readonly changeOrderForJobId?: string | null;
    /** Discount / tax / deposit agreed at the door. Absent means none — see the doc above. */
    readonly rates?: PricingRates;
  }): Result<Estimate, ValidationError> {
    const rates = args.rates ?? ZERO_RATES;
    const base = Estimate.create({
      id: args.id,
      orgId: args.orgId,
      num: args.num,
      leadId: args.leadId,
      title: args.title,
      status: "accepted",
      origin: "field",
      discBps: rates.discBps,
      taxBps: rates.taxBps,
      depBps: rates.depBps,
      depPaid: zeroMoney,
      validDays: null,
      sentAt: args.now,
      acceptedAt: args.now,
      declinedAt: null,
      declineReason: null,
      changeRequestedAt: null,
      changeRequest: null,
      changeOrderForJobId: args.changeOrderForJobId ?? null,
      // The field-sign transport links job→estimate via jobs.source_estimate_id (setSourceEstimate);
      // this read-side pointer stays null on field sales — there is no convert-at-accept to feed.
      jobId: null,
      publicToken: args.publicToken,
      recommendedTier: null,
      acceptedTier: null,
      tierNames: null,
      termsSnapshot: null,
      lines: args.lines,
      createdAt: args.now,
      updatedAt: args.now,
    });
    if (!base.ok) return base;
    return base.value.withOnSiteSignature(args.signature, args.orgName, args.now);
  }

  /**
   * Re-sign a FIELD-born estimate with a new line set — the customer agreed to a revised on-site
   * price on the same job. The estimate is REPLACED, not duplicated: one job, one field quote,
   * whatever was signed last. Refused on office-born estimates (their signed evidence is frozen —
   * a re-priced office sale must not rewrite the document the customer originally signed).
   *
   * `rates` REPLACES the previous ones rather than merging with them: a re-sign is the customer
   * agreeing to a whole new document, and a discount the tech deliberately removed must not
   * survive because the second call happened to omit it. Absent falls back to what is on the
   * estimate — the shape a caller that has not been taught about rates yet still means.
   */
  resignOnSite(
    lines: readonly EstimateLine[],
    signature: SignatureDraft,
    orgName: string,
    now: Date,
    rates?: PricingRates,
  ): Result<Estimate, ValidationError> {
    if (this.origin() !== "field") {
      return err(validation("only a field-born estimate can be re-signed on site", "origin"));
    }
    if (this.p.status !== "accepted") {
      return err(validation("only an accepted field estimate can be re-signed", "status"));
    }
    const next = rates ?? this.rates();
    const replaced = Estimate.create({
      ...this.p,
      lines,
      discBps: next.discBps,
      taxBps: next.taxBps,
      depBps: next.depBps,
      acceptedAt: now,
      updatedAt: now,
    });
    if (!replaced.ok) return replaced;
    return replaced.value.withOnSiteSignature(signature, orgName, now);
  }

  // Shared tail of the two on-site constructors: freeze the snapshot from the FINAL line set and
  // write the evidence in the same step that produced the instance (never a half-signed estimate).
  // depPaid is NOT stamped (same rule as accept): signing authorises the work — it pays nothing.
  private withOnSiteSignature(
    signature: SignatureDraft,
    orgName: string,
    now: Date,
  ): Result<Estimate, ValidationError> {
    const snapshot = this.toSignedSnapshot(orgName);
    const built = createSignature({ ...signature, signedAt: now, snapshot });
    if (!built.ok) return built;
    return ok(
      new Estimate({
        ...this.p,
        signerName: built.value.signerName,
        signatureSvg: built.value.signatureSvg,
        signerIp: built.value.signerIp,
        signerUserAgent: built.value.signerUserAgent,
        signedAt: built.value.signedAt,
        signedSnapshot: built.value.snapshot,
      }),
    );
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

  /** Turn chasing on or off, and record how many nudges have gone out. */
  setFollowUp(on: boolean, stage: number, now: Date): Result<Estimate, ValidationError> {
    if (!Number.isInteger(stage) || stage < 0) {
      return err(validation("follow-up stage cannot be negative", "followUpStage"));
    }
    return Estimate.create({ ...this.p, followUpOn: on, followUpStage: stage, updatedAt: now });
  }

  get props(): EstimateProps {
    return this.p;
  }

  /**
   * The estimate's sections in render order. Callers read THIS rather than `props.sections` —
   * ordering a group list at each of the four surfaces that renders one is how two of them end
   * up disagreeing.
   */
  get sections(): readonly EstimateSection[] {
    return orderSections(this.p.sections ?? []);
  }

  /** The job costs behind this quote, in the order the estimator entered them. */
  get jobCosts(): readonly EstimateJobCost[] {
    return [...(this.p.jobCosts ?? [])].sort((a, b) => a.props.position - b.props.position);
  }

  /**
   * What the job costs beyond the lines, in cents.
   *
   * Deliberately NOT part of any total, subtotal, tax base or deposit. This is the shop's own
   * number — the customer's bill is the lines. Wiring it into the money chain would charge a
   * customer for the shop's dumpster.
   */
  jobCostTotal(): Money {
    return money(jobCostTotalCents(this.p.jobCosts ?? []));
  }

  /**
   * The lines under one section, in position order — and with `null`, the lines under no section
   * at all, which is where an ungrouped estimate keeps every line it has.
   */
  linesInSection(sectionId: EstimateSectionId | null): readonly EstimateLine[] {
    return this.p.lines
      .filter((line) => (line.props.sectionId ?? null) === sectionId)
      .sort((a, b) => a.props.position - b.props.position);
  }
}
