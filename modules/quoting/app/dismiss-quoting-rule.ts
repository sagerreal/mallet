import type { QuotingRuleId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import type { QuotingRule } from "../domain/quoting-rule";
import type { QuotingRuleRepository } from "../domain/quoting-rule-repository";

export interface DismissQuotingRuleCommand {
  readonly ruleId: QuotingRuleId;
}

// Take a rule out of force: dismiss a proposal from the review queue, or
// "forget" a confirmed rule from settings. Same operation — invalidatedAt is
// stamped, the row survives (supersede-never-delete). Idempotent.
export class DismissQuotingRuleUseCase {
  constructor(
    private readonly repo: QuotingRuleRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: DismissQuotingRuleCommand): Promise<Result<QuotingRule, AppError>> {
    const rule = await this.repo.findById(cmd.ruleId);
    if (!rule) return err(notFound("quoting rule"));
    const invalidated = rule.invalidate(this.clock.now());
    if (invalidated !== rule) await this.repo.save(invalidated);
    return ok(invalidated);
  }
}
