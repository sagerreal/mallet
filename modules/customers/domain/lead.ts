import type { LeadId, OrgId, CompanyId, Phone, Money, Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";
import { normalizeTags, tagsWithinLength, MAX_TAGS, MAX_TAG_LENGTH } from "./customer-tags";

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
  /** Office-defined {label, value} pairs — display-only facts, order preserved. */
  readonly customFields: readonly { label: string; value: string }[] | null;
  /**
   * WHERE THE ROW CAME FROM — machine-written provenance ("AI Front Desk", "Import",
   * "Added manually"), not a label anybody chose. No longer editable from any screen; the office's
   * own labels are `tags`. Read by the composer's draft-run to name a request.
   */
  readonly source: string | null;
  /** The office's own labels for this customer. Always a list, empty when untagged — never null. */
  readonly tags: readonly string[];
  readonly stage: LeadStage;
  readonly value: Money;
  readonly unread: boolean;
  readonly wonAt: Date | null;
  // B2B link: the company this contact works for (null = individual/residential contact).
  readonly companyId: CompanyId | null;
  // The contact's role at the company (e.g. "Property manager"). Null when no company or unknown.
  readonly role: string | null;
  // Free-form notes (gate code, call preferences, etc.). Null when not provided.
  readonly notes: string | null;
  // Why the customer went elsewhere ("Price", "No response"). Written when a quote is declined;
  // was dropped by the store's update payload builder, so the answer was gone by the next refetch.
  readonly lossReason: string | null;
  // The shop-defined pipeline stage this customer sits in (pipeline_stages.id). Null = unstaged,
  // which is every customer in a shop that never set a pipeline up. MANUAL placement — the board
  // and the sheet picker write it; no derivation ever does.
  readonly pipelineStageId: string | null;
  // Service address for field work (e.g. "123 Main St, Oakland CA 94601"). Null when not captured.
  readonly address: string | null;
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
    // Normalise BEFORE the count check so twenty pastes of the same tag are one tag, not a
    // rejection — and so the limits describe the stored set rather than what was typed at it.
    const tags = normalizeTags(props.tags ?? []);
    if (tags.length > MAX_TAGS) {
      return err(validation(`a customer can carry at most ${MAX_TAGS} tags`, "tags"));
    }
    if (!tagsWithinLength(tags)) {
      return err(validation(`a tag cannot be longer than ${MAX_TAG_LENGTH} characters`, "tags"));
    }
    return ok(new Lead({ ...props, name, tags }));
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

  // Place in (or remove from) a shop-defined pipeline stage. No-op when already there —
  // dropping a card on its own column must not stamp updatedAt. Existence/liveness of the target
  // stage is the use case's check (it needs the repository); cross-org linkage is the composite
  // FK's (leads_org_pipeline_stage_fk).
  setPipelineStage(stageId: string | null, now: Date): Lead {
    if (stageId === this.p.pipelineStageId) return this;
    return new Lead({ ...this.p, pipelineStageId: stageId, updatedAt: now });
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

  // Patch a subset of fields. Undefined = keep current; explicit null is allowed for
  // phone/email/source/companyId/role. `tags` REPLACES the set (it is not merged) — the picker
  // sends what the customer should end up with, so an untick has to be able to remove one. All invariants are re-validated through Lead.create so the
  // domain stays the single source of truth. stage/unread have their own methods and are NOT
  // patched here.
  patch(
    fields: {
      name?: string;
      phone?: Phone | null;
      email?: string | null;
      customFields?: readonly { label: string; value: string }[] | null;
      source?: string | null;
      tags?: readonly string[];
      value?: Money;
      companyId?: CompanyId | null;
      role?: string | null;
      notes?: string | null;
      address?: string | null;
      lossReason?: string | null;
    },
    now: Date,
  ): Result<Lead, ValidationError> {
    // Trim notes to null when empty string — preserve null for "not set".
    const notes =
      fields.notes !== undefined
        ? (fields.notes?.trim() || null)
        : this.p.notes;
    // Trim address to null when empty string.
    const address =
      fields.address !== undefined
        ? (fields.address?.trim() || null)
        : this.p.address;
    const lossReason =
      fields.lossReason !== undefined
        ? (fields.lossReason?.trim() || null)
        : this.p.lossReason;
    return Lead.create({
      ...this.p,
      name: fields.name !== undefined ? fields.name : this.p.name,
      phone: fields.phone !== undefined ? fields.phone : this.p.phone,
      email: fields.email !== undefined ? fields.email : this.p.email,
      customFields: fields.customFields !== undefined ? fields.customFields : this.p.customFields,
      source: fields.source !== undefined ? fields.source : this.p.source,
      tags: fields.tags !== undefined ? fields.tags : this.p.tags,
      value: fields.value !== undefined ? fields.value : this.p.value,
      companyId: fields.companyId !== undefined ? fields.companyId : this.p.companyId,
      role: fields.role !== undefined ? fields.role : this.p.role,
      notes,
      address,
      lossReason,
      updatedAt: now,
    });
  }

  get props(): LeadProps {
    return this.p;
  }
}
