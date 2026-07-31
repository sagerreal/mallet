import { randomBytes } from "node:crypto";
import type { OrgId, LeadId, Result, AppError, Clock } from "@mallet/shared/types";
import { asEstimateId, asEstimateLineId, money, zeroMoney, validation, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { Estimate, EstimateLine } from "../domain/estimate";
import type { QuoteTier, TierNames } from "../domain/estimate";
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
  /** Good/Better/Best tag — required on every line of a tiered draft, absent otherwise. */
  readonly tier?: QuoteTier | null;
  readonly materialId?: string | null;
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
  /**
   * The job this quote adds work to — makes it a CHANGE ORDER.
   *
   * Absent on an ordinary quote. Present when the quote was raised from inside a job already
   * running: more was found on site, it was priced, and the customer signs for the extra exactly
   * as they signed for the original.
   */
  readonly changeOrderForJobId?: string | null;
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

    const built: EstimateLine[] = [];
    for (let i = 0; i < cmd.lines.length; i += 1) {
      const input = cmd.lines[i];
      if (!input) continue;
      const line = EstimateLine.create({
        id: asEstimateLineId(this.ids.newId()),
        description: input.description,
        quantity: input.quantity,
        rate: money(input.rateCents),
        cost: money(input.costCents),
        isOptional: input.isOptional,
        needsPhoto: input.needsPhoto,
        position: i,
        tier: input.tier ?? null,
        materialId: input.materialId ?? null,
      });
      if (!isOk(line)) return line;
      built.push(line.value);
    }
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
      publicToken: generatePublicToken(),
      recommendedTier: cmd.recommendedTier ?? null,
      acceptedTier: null,
      tierNames: cmd.tierNames ?? null,
      termsSnapshot: cmd.termsSnapshot ?? null,
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
}
