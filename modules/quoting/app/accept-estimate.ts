import type { EstimateId, Result, AppError, Clock } from "@mallet/shared/types";
import { asEstimateLineId, money, notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { EstimateLine } from "../domain/estimate";
import type { Estimate, QuoteTier } from "../domain/estimate";
import type { EstimateRepository } from "../domain/estimate-repository";
import type { SignatureDraft } from "../domain/signature";

export interface AcceptLineInput {
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly costCents: number;
  readonly isOptional: boolean;
  readonly needsPhoto: boolean;
  /** Carried from the STORED line the accept path rebuilt this from — never client-authored
   *  (see select-optional-lines.ts). Omitted it reads as TRUE. */
  readonly taxable?: boolean;
}

export interface AcceptEstimateCommand {
  readonly estimateId: EstimateId;
  /** Optional: customer-selected lines (including toggled-on optional add-ons).
   *  When provided the estimate's line set is replaced BEFORE acceptance so the
   *  accepted total reflects what the customer actually chose. Line IDs are
   *  allocated by the server; position is the array index. */
  readonly lines?: readonly AcceptLineInput[];
  /** Good/Better/Best choice. Required by the domain for tiered estimates; omitted
   *  here it defaults to the RECOMMENDED tier (the office accept path). Rejected by
   *  the domain on single-format estimates. */
  readonly chosenTier?: QuoteTier;
  /** Signature evidence from the public page. Absent on the office path — an office user marking
   *  a phone approval accepted has no signature, and that is a real, weaker state, not an error. */
  readonly signature?: SignatureDraft;
  /** Shop name, so the authorisation sentence names a counterparty. Required with a signature. */
  readonly orgName?: string;
}

// Customer accepts the quote. Emits estimate.accepted for the audit outbox — note the event has
// NO registered handler (trpc/outbox-registry.ts drains it as a no-op): job creation and the
// lead's move to "won" happen INLINE in the composing callers (acceptPublicQuote and the office
// accept route), not via the event.
// If the command carries lines (customer-tuned optional add-ons), those are committed before the
// status transition so the accepted total matches what the customer approved.
export class AcceptEstimateUseCase {
  constructor(
    private readonly repo: EstimateRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    private readonly ids?: IdGenerator,
  ) {}

  async exec(cmd: AcceptEstimateCommand): Promise<Result<Estimate, AppError>> {
    const estimate = await this.repo.findById(cmd.estimateId);
    if (!estimate) return err(notFound("estimate"));

    const now = this.clock.now();

    // If lines are provided, build EstimateLine value objects and replace the line set first.
    // withLinesForAccept bypasses the draft-only guard because we're replacing at accept time.
    let current = estimate;
    if (cmd.lines && cmd.lines.length > 0) {
      const built: EstimateLine[] = [];
      for (let i = 0; i < cmd.lines.length; i += 1) {
        const input = cmd.lines[i];
        if (!input) continue;
        const idGen = this.ids ?? { newId: () => crypto.randomUUID() };
        const line = EstimateLine.create({
          id: asEstimateLineId(idGen.newId()),
          description: input.description,
          quantity: input.quantity,
          rate: money(input.rateCents),
          cost: money(input.costCents),
          isOptional: input.isOptional,
          needsPhoto: input.needsPhoto,
          taxable: input.taxable ?? true,
          position: i,
          // Committed accept-time lines are always resolved — never tier-tagged.
          tier: null,
          materialId: null,
        });
        if (!isOk(line)) return line;
        built.push(line.value);
      }
      current = estimate.withLinesForAccept(built, now);
    }

    // Tiered estimates need a tier to resolve to; the office path defaults to the
    // recommended tier. The public path always passes an explicit choice (validated
    // upstream). Single-format estimates pass nothing — the domain rejects a stray tier.
    const chosenTier = cmd.chosenTier ?? estimate.props.recommendedTier ?? undefined;
    const accepted = current.accept(now, chosenTier, cmd.signature, cmd.orgName);
    if (!isOk(accepted)) return accepted;

    await this.repo.save(accepted.value);
    await this.bus.emit({
      name: "estimate.accepted",
      orgId: accepted.value.props.orgId,
      payload: {
        estimateId: accepted.value.props.id,
        leadId: accepted.value.props.leadId,
        totalCents: accepted.value.total(),
        depositDueCents: accepted.value.depositDue(),
      },
      occurredAt: now,
    });
    return ok(accepted.value);
  }
}
