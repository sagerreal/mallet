import type { LeadId, OrgId, Phone, Money, Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

// The pipeline stages a lead moves through. A fixed enum for the pilot — custom per-org
// stages (the prototype's draggable columns) are deferred (YAGNI) until a tenant needs them.
export type LeadStage = "new" | "contacted" | "quote_sent" | "won" | "lost";

export const LEAD_STAGES: readonly LeadStage[] = [
  "new",
  "contacted",
  "quote_sent",
  "won",
  "lost",
];

export const isLeadStage = (value: string): value is LeadStage =>
  (LEAD_STAGES as readonly string[]).includes(value);

export interface LeadProps {
  readonly id: LeadId;
  readonly orgId: OrgId;
  readonly name: string;
  readonly phone: Phone | null;
  readonly email: string | null;
  readonly source: string | null;
  readonly stage: LeadStage;
  readonly value: Money;
  readonly unread: boolean;
  readonly wonAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// A customer/lead in the sales pipeline. All mutations return a new Lead (immutability);
// invariants live in the factory so an invalid Lead cannot exist.
export class Lead {
  private constructor(private readonly p: LeadProps) {}

  static create(props: LeadProps): Result<Lead, ValidationError> {
    const name = props.name.trim();
    if (name.length === 0) return err(validation("lead name is required", "name"));
    if (props.value < 0) return err(validation("lead value cannot be negative", "value"));
    return ok(new Lead({ ...props, name }));
  }

  // Move to a target stage. Reaching "won" stamps wonAt once; re-moving to the current stage
  // is a no-op (returns the same instance, preserving the original wonAt).
  moveStage(target: LeadStage, now: Date): Lead {
    if (target === this.p.stage) return this;
    const wonAt = target === "won" ? (this.p.wonAt ?? now) : this.p.wonAt;
    return new Lead({ ...this.p, stage: target, wonAt, updatedAt: now });
  }

  // First outbound contact advances a brand-new lead to Contacted. No-op once past New.
  firstTouch(now: Date): Lead {
    if (this.p.stage !== "new") return this;
    return new Lead({ ...this.p, stage: "contacted", updatedAt: now });
  }

  // Clear the unread flag (e.g. the owner opened the lead). No-op if already read.
  markRead(now: Date): Lead {
    if (!this.p.unread) return this;
    return new Lead({ ...this.p, unread: false, updatedAt: now });
  }

  get props(): LeadProps {
    return this.p;
  }
}
