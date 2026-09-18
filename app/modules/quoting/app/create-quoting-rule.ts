import type { OrgId, UserId, Result, AppError, Clock } from "@mallet/shared/types";
import { asQuotingRuleId, asServiceId, asEstimateId, ok } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import type { Role } from "@mallet/identity";
import { QuotingRule, type QuotingRuleSource, type QuotingRuleStatus } from "../domain/quoting-rule";
import type { QuotingRuleRepository } from "../domain/quoting-rule-repository";
import { scopesOverlap } from "../domain/rule-match";

export interface CreateQuotingRuleCommand {
  readonly orgId: OrgId;
  readonly authorUserId: UserId;
  /** The caller's verified role — decides whether the rule lands live or in review. */
  readonly role: Role;
  readonly rule: string;
  readonly serviceId?: string | null;
  readonly jobTag?: string | null;
  /** 'manual' (settings) or 'refine' (composer chip). edit_delta rules come from the miner, not here. */
  readonly source: Extract<QuotingRuleSource, "manual" | "refine">;
  readonly sourceEstimateId?: string | null;
}

// Role-weighted memory writes: owner/office corrections go live immediately
// (they run the desk — waiting on a queue would kill the flywheel), EXCEPT
// when the new rule overlaps an existing confirmed one — a potential
// contradiction always lands in review, whoever wrote it. Any other role
// (defense-in-depth; the router already forbids techs) can only propose.
export class CreateQuotingRuleUseCase {
  constructor(
    private readonly repo: QuotingRuleRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CreateQuotingRuleCommand): Promise<Result<QuotingRule, AppError>> {
    const now = this.clock.now();
    const scope = { serviceId: cmd.serviceId ?? null, jobTag: cmd.jobTag?.trim() || null };

    let status: QuotingRuleStatus = cmd.role === "owner" || cmd.role === "office" ? "confirmed" : "proposed";
    if (status === "confirmed") {
      const confirmed = await this.repo.listConfirmed();
      const contradicts = confirmed.some((r) =>
        scopesOverlap(scope, { serviceId: r.props.serviceId, jobTag: r.props.jobTag }),
      );
      if (contradicts) status = "proposed";
    }

    const rule = QuotingRule.create({
      id: asQuotingRuleId(this.ids.newId()),
      orgId: cmd.orgId,
      rule: cmd.rule,
      serviceId: scope.serviceId ? asServiceId(scope.serviceId) : null,
      jobTag: scope.jobTag,
      status,
      source: cmd.source,
      authorUserId: cmd.authorUserId,
      sourceEstimateId: cmd.sourceEstimateId ? asEstimateId(cmd.sourceEstimateId) : null,
      timesConfirmed: 1,
      validFrom: now,
      invalidatedAt: null,
      supersededBy: null,
      createdAt: now,
      updatedAt: now,
    });
    if (!rule.ok) return rule;

    await this.repo.save(rule.value);
    return ok(rule.value);
  }
}
