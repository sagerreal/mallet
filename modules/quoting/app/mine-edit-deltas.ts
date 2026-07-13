import type { OrgId, EstimateId, Result, AppError, Clock } from "@mallet/shared/types";
import { asQuotingRuleId, ok } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { QuotingRule } from "../domain/quoting-rule";
import type { QuotingRuleRepository } from "../domain/quoting-rule-repository";
import { diffAiDraft, type AiDraftSnapshot, type SentLineView } from "../domain/edit-delta";

export interface MineEditDeltasCommand {
  readonly orgId: OrgId;
  readonly estimateId: EstimateId;
  readonly snapshot: AiDraftSnapshot;
  readonly sentLines: readonly SentLineView[];
}

export interface MineEditDeltasResult {
  readonly created: number;
  readonly bumped: number;
}

// The back door of the estimator's memory — and the reason it can be trusted:
// NOTHING here writes a live rule. Every material delta lands (or bumps) a
// PROPOSED rule with source 'edit_delta'; the review queue only surfaces it
// after ≥2 independent recurrences, and only a human confirm makes it live.
// Equivalence = same jobTag + same rule prefix (kind + direction), so the
// same correction seen on two different sends counts as corroboration, not
// duplication.
export class MineEditDeltasUseCase {
  constructor(
    private readonly rules: QuotingRuleRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: MineEditDeltasCommand): Promise<Result<MineEditDeltasResult, AppError>> {
    const deltas = diffAiDraft(cmd.snapshot.lines, cmd.sentLines);
    const now = this.clock.now();
    let created = 0;
    let bumped = 0;

    for (const delta of deltas) {
      const existing = await this.rules.listProposedEditDeltasByTag(delta.jobTag);
      const equivalent = existing.find((r) => r.props.rule.startsWith(delta.rulePrefix));
      if (equivalent) {
        await this.rules.save(equivalent.bump(now));
        bumped += 1;
        continue;
      }

      const rule = QuotingRule.create({
        id: asQuotingRuleId(this.ids.newId()),
        orgId: cmd.orgId,
        rule: delta.rule,
        serviceId: null,
        jobTag: delta.jobTag,
        status: "proposed",
        source: "edit_delta",
        authorUserId: null,
        sourceEstimateId: cmd.estimateId,
        timesConfirmed: 1,
        validFrom: now,
        invalidatedAt: null,
        supersededBy: null,
        createdAt: now,
        updatedAt: now,
      });
      // A delta whose generated rule fails domain validation is dropped, not fatal —
      // mining is best-effort by design (the send must never depend on it).
      if (!rule.ok) continue;
      await this.rules.save(rule.value);
      created += 1;
    }

    return ok({ created, bumped });
  }
}
