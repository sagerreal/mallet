import type { LeadId, OrgId, CompanyId, Phone, Money, Result, ValidationError } from "@mallet/shared/types";
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
  // B2B link: the company this contact works for (null = individual/residential contact).
  readonly companyId: CompanyId | null;
  // The contact's role at the company (e.g. "Property manager"). Null when no company or unknown.
  readonly role: string | null;
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

  // Set the unread flag (e.g. a new inbound SMS arrived). No-op if already unread (idempotent).
  markUnread(now: Date): Lead {
    if (this.p.unread) return this;
    return new Lead({ ...this.p, unread: true, updatedAt: now });
  }

  // Patch a subset of scalar fields. Undefined = keep current; explicit null is allowed for
  // phone/email/source/companyId/role. All invariants are re-validated through Lead.create so the
  // domain stays the single source of truth. stage/unread have their own methods and are NOT
  // patched here.
  patch(
    fields: {
      name?: string;
      phone?: Phone | null;
      email?: string | null;
      source?: string | null;
      value?: Money;
      companyId?: CompanyId | null;
      role?: string | null;
    },
    now: Date,
  ): Result<Lead, ValidationError> {
    return Lead.create({
      ...this.p,
      name: fields.name !== undefined ? fields.name : this.p.name,
      phone: fields.phone !== undefined ? fields.phone : this.p.phone,
      email: fields.email !== undefined ? fields.email : this.p.email,
      source: fields.source !== undefined ? fields.source : this.p.source,
      value: fields.value !== undefined ? fields.value : this.p.value,
      companyId: fields.companyId !== undefined ? fields.companyId : this.p.companyId,
      role: fields.role !== undefined ? fields.role : this.p.role,
      updatedAt: now,
    });
  }

  get props(): LeadProps {
    return this.p;
  }
}
