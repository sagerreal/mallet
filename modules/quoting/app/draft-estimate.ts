import { randomBytes } from "node:crypto";
import type { OrgId, LeadId, EstimateLineId, Result, AppError, Clock } from "@mallet/shared/types";
import { asEstimateId, asEstimateLineId, money, zeroMoney, validation, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { Estimate, EstimateLine } from "../domain/estimate";
import type { EstimateSubItem, PresentationSnapshot, PriceDisplay, QuoteTier, TierNames } from "../domain/estimate";
import type { EstimateRepository } from "../domain/estimate-repository";
import type { AiDraftLine } from "../domain/edit-delta";

// Generate an unguessable, URL-safe token for the public quote page.
// 32 random bytes = 256 bits of entropy, hex-encoded = 64 characters.
// This is generated at draft time and never changes.
const generatePublicToken = (): string => randomBytes(32).toString("hex");

export interface EstimateLineInput {
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly costCents: number;
  readonly isOptional: boolean;
  readonly needsPhoto: boolean;
  /** Does this line take sales tax. Seeded by the composer from the pricebook item/material the
   *  line came from; omitted it reads as TRUE (see EstimateLineCreateProps). */
  readonly taxable?: boolean;
  /** Good/Better/Best tag — required on every line of a tiered draft, absent otherwise. */
  readonly tier?: QuoteTier | null;
  readonly materialId?: string | null;
  /** Customer-facing scope prose under the line — the proposal's Includes/Excludes/Products. */
  readonly scope?: string | null;
  /** Internal estimating math behind the price. Never reaches a customer surface. */
  readonly subItems?: readonly EstimateSubItem[] | null;
  /** What the quantity is counted in ("LF", "hr"). */
  readonly unit?: string | null;
  /** How the quantity was authored, when typed as math ("qty/8+1"). */
  readonly qtyExpr?: string | null;
  readonly roundUp?: boolean;
  /** The parent this line is a component of, as an index into this same payload. */
  readonly parentIndex?: number | null;
  readonly customerVisible?: boolean;
  readonly markupBps?: number | null;
}

export interface DraftEstimateCommand {
  readonly orgId: OrgId;
  readonly leadId: LeadId;
  readonly title: string | null;
  readonly discBps: number;
  readonly taxBps: number;
  readonly depBps: number;
  readonly validDays: number | null;
  readonly lines: readonly EstimateLineInput[];
  /** Non-null marks the draft as Good/Better/Best (domain validates line tags match). */
  readonly recommendedTier?: QuoteTier | null;
  readonly tierNames?: TierNames | null;
  /** Snapshot of the selected job terms TEXT (no live reference). */
  readonly termsSnapshot?: string | null;
  /** Which numbers the customer sees — 'lines' (default) or 'total'. */
  readonly priceDisplay?: PriceDisplay | null;
  /** The designed pages to freeze onto this quote — absent on a plain quote. */
  readonly presentationSnapshot?: PresentationSnapshot | null;
  /**
   * The job this quote adds work to — makes it a CHANGE ORDER.
   *
   * Absent on an ordinary quote. Present when the quote was raised from inside a job already
   * running: more was found on site, it was priced, and the customer signs for the extra exactly
   * as they signed for the original.
   */
  readonly changeOrderForJobId?: string | null;
  /**
   * The scope-visit job this quote prices — the walkthrough it came from.
   *
   * Absent on a quote with no visit behind it. Present when the composer was opened from the
   * pipeline's scoped card: accept then CONVERTS that job into the sold work instead of minting
   * a duplicate. The transport validates the job (org-scoped, kind='estimate') before it gets here.
   */
  readonly jobId?: string | null;
  /**
   * The AI drafter's ORIGINAL lines, sent by the composer only when this
   * draft originated from the AI. Persisted write-once to estimates.ai_draft;
   * the send path diffs it against the sent lines (edit-delta mining).
   */
  readonly aiDraftLines?: readonly AiDraftLine[] | null;
}

// Create a new draft estimate for a customer: validate + build the line value objects, allocate
// the per-org number, assemble the aggregate, persist, and announce it. Number allocation happens
// only after validation so a rejected draft doesn't burn a number.
export class DraftEstimateUseCase {
  constructor(
    private readonly repo: EstimateRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: DraftEstimateCommand): Promise<Result<Estimate, AppError>> {
    if (cmd.lines.length === 0) {
      return err(validation("an estimate needs at least one line", "lines"));
    }

    const lines = this.buildLines(cmd.lines);
    if (!isOk(lines)) return lines;
    const built = lines.value;
    if (!built.some((line) => !line.props.isOptional)) {
      return err(validation("an estimate needs at least one non-optional line", "lines"));
    }

    const now = this.clock.now();
    const num = await this.repo.nextNumber();
    const estimate = Estimate.create({
      id: asEstimateId(this.ids.newId()),
      orgId: cmd.orgId,
      num,
      leadId: cmd.leadId,
      title: cmd.title,
      status: "draft",
      discBps: cmd.discBps,
      taxBps: cmd.taxBps,
      depBps: cmd.depBps,
      depPaid: zeroMoney,
      validDays: cmd.validDays,
      sentAt: null,
      acceptedAt: null,
      declinedAt: null,
      declineReason: null,
      changeRequestedAt: null,
      changeRequest: null,
      // The job this quote adds work to, when it was raised from inside a running job.
      changeOrderForJobId: cmd.changeOrderForJobId ?? null,
      // The scope-visit job this quote prices — accept converts it instead of minting a new job.
      jobId: cmd.jobId ?? null,
      publicToken: generatePublicToken(),
      recommendedTier: cmd.recommendedTier ?? null,
      acceptedTier: null,
      tierNames: cmd.tierNames ?? null,
      termsSnapshot: cmd.termsSnapshot ?? null,
      priceDisplay: cmd.priceDisplay ?? "lines",
      presentationSnapshot: cmd.presentationSnapshot ?? null,
      lines: built,
      createdAt: now,
      updatedAt: now,
    });
    if (!isOk(estimate)) return estimate;

    await this.repo.save(estimate.value);
    // Snapshot semantics: written once here (setAiDraft ignores rows that already carry one);
    // save() never touches ai_draft, so later edits/sends can't rewrite what the AI drafted.
    if (cmd.aiDraftLines && cmd.aiDraftLines.length > 0) {
      await this.repo.setAiDraft(estimate.value.props.id, {
        lines: cmd.aiDraftLines,
        at: now.toISOString(),
      });
    }
    await this.bus.emit({
      name: "estimate.drafted",
      orgId: cmd.orgId,
      payload: { estimateId: estimate.value.props.id, leadId: cmd.leadId, num },
      occurredAt: now,
    });
    return ok(estimate.value);
  }

  /** Validate + build the line value objects, positions preserved. First bad line fails fast. */
  private buildLines(
    inputs: readonly EstimateLineInput[],
  ): Result<EstimateLine[], AppError> {
    const built: EstimateLine[] = [];
    // Mint every id up front so a component can name its parent before that parent is built.
    const ids = inputs.map(() => asEstimateLineId(this.ids.newId()));
    for (let i = 0; i < inputs.length; i += 1) {
      const input = inputs[i];
      if (!input) continue;
      // A component's parent is an index into this payload; the server mints the ids, so
      // resolve it here. Only one level: a component cannot itself carry components, which
      // keeps the customer's document a list of priced lines rather than a tree.
      let parentLineId: EstimateLineId | null = null;
      let driverQuantity: number | null = null;
      if (input.parentIndex != null) {
        const parentInput = inputs[input.parentIndex];
        if (input.parentIndex >= i || !parentInput) {
          return err(validation("a component must follow the line it belongs to", "parentIndex"));
        }
        if (parentInput.parentIndex != null) {
          return err(validation("a component cannot have components of its own", "parentIndex"));
        }
        const resolved = ids[input.parentIndex];
        if (!resolved) return err(validation("unknown parent line", "parentIndex"));
        parentLineId = resolved;
        driverQuantity = parentInput.quantity;
      }
      const line = EstimateLine.create({
        id: ids[i]!,
        description: input.description,
        quantity: input.quantity,
        rate: money(input.rateCents),
        cost: money(input.costCents),
        isOptional: input.isOptional,
        needsPhoto: input.needsPhoto,
        taxable: input.taxable ?? true,
        position: i,
        tier: input.tier ?? null,
        materialId: input.materialId ?? null,
        scope: input.scope ?? null,
        subItems: input.subItems ?? null,
        unit: input.unit ?? null,
        qtyExpr: input.qtyExpr ?? null,
        roundUp: input.roundUp ?? false,
        parentLineId,
        // Supplying the driver is what makes create() re-run the math and reject a quantity the
        // expression does not produce. Absent for a top-level line, which has no driver.
        driverQuantity,
        customerVisible: input.customerVisible ?? true,
        markupBps: input.markupBps ?? null,
      });
      if (!isOk(line)) return line;
      built.push(line.value);
    }
    return ok(built);
  }
}
