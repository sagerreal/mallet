import type { QuotingRuleId } from "@mallet/shared/types";
import type { QuotingRule } from "./quoting-rule";
import type { RuleCandidate } from "./rule-match";

// Port for the estimator's learned-rule store. org_id is implicit in the
// tenant-scoped tx (RLS) — never a parameter. Rules are tiny per-org sets;
// list methods carry internal caps rather than cursor pagination.
export interface QuotingRuleRepository {
  /** Upsert (insert new / update transitioned). */
  save(rule: QuotingRule): Promise<void>;

  findById(id: QuotingRuleId): Promise<QuotingRule | null>;

  /** Active confirmed rules, times_confirmed desc — what prompts consume. */
  listConfirmed(): Promise<QuotingRule[]>;

  /**
   * The review queue: active proposed rules worth a human's attention —
   * edit-delta proposals only after ≥2 independent recurrences (never surface
   * a one-off), manual/refine proposals immediately (a person authored them).
   */
  listProposed(): Promise<QuotingRule[]>;

  /**
   * Active confirmed rules that apply to this job text (keyword match on the
   * scoped service's name / the job tag; unscoped rules always apply),
   * times_confirmed desc, capped.
   */
  findMatching(jobText: string, limit?: number): Promise<RuleCandidate[]>;

  /**
   * ALL active edit-delta proposals (source 'edit_delta', status 'proposed'),
   * capped. The miner matches an observation against these itself (service-id
   * anchor or token-set overlap) and bumps times_confirmed on the equivalent
   * one instead of stacking duplicates.
   */
  listProposedEditDeltas(): Promise<QuotingRule[]>;
}
