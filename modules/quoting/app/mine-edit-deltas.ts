import type { OrgId, EstimateId, ServiceId, Result, AppError, Clock } from "@mallet/shared/types";
import { asQuotingRuleId, ok } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { QuotingRule } from "../domain/quoting-rule";
import type { QuotingRuleRepository } from "../domain/quoting-rule-repository";
import type { ServiceNameReader } from "../domain/service-name-reader";
import {
  diffAiDraft,
  jobTagFor,
  tagTokenOverlap,
  type AiDraftSnapshot,
  type EditDelta,
  type SentLineView,
} from "../domain/edit-delta";

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

/** Minimum token-set overlap between two job tags to count as the same correction. */
export const RECURRENCE_TAG_OVERLAP = 0.6;

// Two observations corroborate when they describe the SAME correction:
// kind + direction ride the rulePrefix; the line anchor is the matched
// pricebook service id when the line matched a service, else token-set
// overlap ≥60% between the tags (the AI phrases the same line differently
// per estimate — exact-string equivalence would almost never recur).
const isEquivalent = (
  existing: QuotingRule,
  delta: EditDelta,
  serviceId: ServiceId | null,
): boolean => {
  if (!existing.props.rule.startsWith(delta.rulePrefix)) return false;
  if (serviceId !== null) return existing.props.serviceId === serviceId;
  return (
    existing.props.serviceId === null &&
    existing.props.jobTag !== null &&
    tagTokenOverlap(existing.props.jobTag, delta.jobTag) >= RECURRENCE_TAG_OVERLAP
  );
};

// The back door of the estimator's memory — and the reason it can be trusted:
// NOTHING here writes a live rule. Every material delta lands (or bumps) a
// PROPOSED rule with source 'edit_delta'; the review queue only surfaces it
// after ≥2 independent recurrences, and only a human confirm makes it live.
export class MineEditDeltasUseCase {
  constructor(
    private readonly rules: QuotingRuleRepository,
    private readonly services: ServiceNameReader,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: MineEditDeltasCommand): Promise<Result<MineEditDeltasResult, AppError>> {
    const deltas = diffAiDraft(cmd.snapshot.lines, cmd.sentLines);
    if (deltas.length === 0) return ok({ created: 0, bumped: 0 });

    // Anchor map: normalized service name → service id. First name wins on a
    // (pathological) normalized collision — deterministic and harmless, the
    // anchor only groups recurrences.
    const serviceIdByTag = new Map<string, ServiceId>();
    for (const s of await this.services.listActiveNames()) {
      const tag = jobTagFor(s.name);
      if (tag !== "" && !serviceIdByTag.has(tag)) serviceIdByTag.set(tag, s.id);
    }

    // One load per send; rules created/bumped below join the in-memory set so
    // two equivalent deltas within the SAME send corroborate, not duplicate.
    const known = [...(await this.rules.listProposedEditDeltas())];
    const now = this.clock.now();
    let created = 0;
    let bumped = 0;

    for (const delta of deltas) {
      const serviceId = serviceIdByTag.get(delta.jobTag) ?? null;
      const index = known.findIndex((r) => isEquivalent(r, delta, serviceId));
      if (index !== -1) {
        const bumpedRule = known[index]!.bump(now);
        await this.rules.save(bumpedRule);
        known[index] = bumpedRule;
        bumped += 1;
        continue;
      }

      const rule = QuotingRule.create({
        id: asQuotingRuleId(this.ids.newId()),
        orgId: cmd.orgId,
        rule: delta.rule,
        serviceId,
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
      known.push(rule.value);
      created += 1;
    }

    return ok({ created, bumped });
  }
}
