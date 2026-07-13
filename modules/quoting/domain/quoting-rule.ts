import type {
  QuotingRuleId,
  OrgId,
  UserId,
  ServiceId,
  EstimateId,
  Result,
  ValidationError,
} from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

// ---------------------------------------------------------------------------
// QuotingRule — one learned conditional of the estimator's memory.
// ---------------------------------------------------------------------------
// The pricebook itself absorbs service-general scalars (labor hours, prices);
// this value object holds only what a scalar can't: "add 2h when the house is
// pre-1980". 'confirmed' rules reach prompts; 'proposed' rules wait in the
// review queue. Supersede-never-delete: invalidation stamps invalidatedAt (and
// optionally supersededBy) so history survives. Immutable — every transition
// returns a new instance.
// ---------------------------------------------------------------------------

export type QuotingRuleStatus = "proposed" | "confirmed";
export type QuotingRuleSource = "manual" | "refine" | "edit_delta";

export const QUOTING_RULE_STATUSES: readonly QuotingRuleStatus[] = ["proposed", "confirmed"];
export const QUOTING_RULE_SOURCES: readonly QuotingRuleSource[] = ["manual", "refine", "edit_delta"];

export const isQuotingRuleStatus = (v: string): v is QuotingRuleStatus =>
  (QUOTING_RULE_STATUSES as readonly string[]).includes(v);
export const isQuotingRuleSource = (v: string): v is QuotingRuleSource =>
  (QUOTING_RULE_SOURCES as readonly string[]).includes(v);

export const RULE_MAX_LENGTH = 300;
export const JOB_TAG_MAX_LENGTH = 100;

export interface QuotingRuleProps {
  readonly id: QuotingRuleId;
  readonly orgId: OrgId;
  /** The rule itself — one human-readable sentence, ≤300 chars. */
  readonly rule: string;
  /** Optional scoping: a specific pricebook service… */
  readonly serviceId: ServiceId | null;
  /** …or a free-text job tag ("water heater"). Unscoped rules apply to every quote. */
  readonly jobTag: string | null;
  readonly status: QuotingRuleStatus;
  readonly source: QuotingRuleSource;
  readonly authorUserId: UserId | null;
  readonly sourceEstimateId: EstimateId | null;
  /** How many independent observations back this rule (edit-delta recurrence counter). */
  readonly timesConfirmed: number;
  readonly validFrom: Date;
  readonly invalidatedAt: Date | null;
  readonly supersededBy: QuotingRuleId | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class QuotingRule {
  private constructor(private readonly p: QuotingRuleProps) {}

  static create(props: QuotingRuleProps): Result<QuotingRule, ValidationError> {
    const rule = props.rule.trim();
    if (rule.length === 0) return err(validation("a rule needs text", "rule"));
    if (rule.length > RULE_MAX_LENGTH) {
      return err(validation(`a rule must be ${RULE_MAX_LENGTH} characters or fewer`, "rule"));
    }
    if (!isQuotingRuleStatus(props.status)) {
      return err(validation(`unknown rule status: ${props.status}`, "status"));
    }
    if (!isQuotingRuleSource(props.source)) {
      return err(validation(`unknown rule source: ${props.source}`, "source"));
    }
    if (!Number.isInteger(props.timesConfirmed) || props.timesConfirmed < 1) {
      return err(validation("timesConfirmed must be a positive integer", "timesConfirmed"));
    }
    const jobTag = props.jobTag?.trim() || null;
    if (jobTag !== null && jobTag.length > JOB_TAG_MAX_LENGTH) {
      return err(validation(`a job tag must be ${JOB_TAG_MAX_LENGTH} characters or fewer`, "jobTag"));
    }
    return ok(new QuotingRule({ ...props, rule, jobTag }));
  }

  /** Still in force (not invalidated/superseded). */
  isActive(): boolean {
    return this.p.invalidatedAt === null;
  }

  /** Proposed → confirmed. Idempotent: an already-confirmed rule returns the same instance. */
  confirm(now: Date): Result<QuotingRule, ValidationError> {
    if (!this.isActive()) return err(validation("an invalidated rule cannot be confirmed", "status"));
    if (this.p.status === "confirmed") return ok(this);
    return ok(new QuotingRule({ ...this.p, status: "confirmed", updatedAt: now }));
  }

  /**
   * Take the rule out of force (dismiss a proposal / forget a confirmed rule).
   * `supersededBy` links to the rule that replaced it, when one exists.
   * Idempotent: an already-invalidated rule returns the same instance.
   */
  invalidate(now: Date, supersededBy: QuotingRuleId | null = null): QuotingRule {
    if (!this.isActive()) return this;
    return new QuotingRule({ ...this.p, invalidatedAt: now, supersededBy, updatedAt: now });
  }

  /** One more independent observation of the same correction (edit-delta recurrence). */
  bump(now: Date): QuotingRule {
    return new QuotingRule({ ...this.p, timesConfirmed: this.p.timesConfirmed + 1, updatedAt: now });
  }

  get props(): QuotingRuleProps {
    return this.p;
  }
}
