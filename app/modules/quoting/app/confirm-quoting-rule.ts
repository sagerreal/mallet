import type { QuotingRuleId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err, isOk } from "@mallet/shared/types";
import type { QuotingRule } from "../domain/quoting-rule";
import type { QuotingRuleRepository } from "../domain/quoting-rule-repository";
import { scopesOverlap } from "../domain/rule-match";

export interface ConfirmQuotingRuleCommand {
  readonly ruleId: QuotingRuleId;
}

// Promote a proposed rule to confirmed. Supersede chain: any existing
// confirmed rule whose scope overlaps the promoted one is invalidated with
// supersededBy pointing at it — the shop's memory holds ONE live answer per
// scope, and history survives (nothing is deleted).
export class ConfirmQuotingRuleUseCase {
  constructor(
    private readonly repo: QuotingRuleRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: ConfirmQuotingRuleCommand): Promise<Result<QuotingRule, AppError>> {
    const rule = await this.repo.findById(cmd.ruleId);
    if (!rule) return err(notFound("quoting rule"));

    const now = this.clock.now();
    const confirmed = rule.confirm(now);
    if (!isOk(confirmed)) return confirmed;
    // Idempotent re-confirm: nothing changed, nothing to supersede.
    if (confirmed.value === rule) return ok(rule);

    const scope = { serviceId: rule.props.serviceId, jobTag: rule.props.jobTag };
    const existing = await this.repo.listConfirmed();
    for (const old of existing) {
      if (old.props.id === rule.props.id) continue;
      if (scopesOverlap(scope, { serviceId: old.props.serviceId, jobTag: old.props.jobTag })) {
        await this.repo.save(old.invalidate(now, confirmed.value.props.id));
      }
    }

    await this.repo.save(confirmed.value);
    return ok(confirmed.value);
  }
}
