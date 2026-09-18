import type {
  ChecklistId,
  ChecklistItemId,
  OrgId,
  Result,
  ValidationError,
} from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

export const CHECKLIST_STAGES = ["job", "scope"] as const;
export type ChecklistStage = (typeof CHECKLIST_STAGES)[number];
export const isChecklistStage = (v: string): v is ChecklistStage =>
  (CHECKLIST_STAGES as readonly string[]).includes(v);

// Per-template item cap — mirrors JOB_CHECKLIST_MAX_ITEMS (modules/jobs/domain/job.ts)
// so every template stays attachable to a job. Enforced at create
// (CreateChecklistUseCase); pre-existing larger templates are not rewritten.
export const CHECKLIST_MAX_ITEMS = 50;

export const CHECKLIST_ITEM_TYPES = ["check", "photo"] as const;
export type ChecklistItemType = (typeof CHECKLIST_ITEM_TYPES)[number];
export const isChecklistItemType = (v: string): v is ChecklistItemType =>
  (CHECKLIST_ITEM_TYPES as readonly string[]).includes(v);

export interface ChecklistItemProps {
  readonly id: ChecklistItemId;
  readonly text: string;
  readonly type: ChecklistItemType;
  readonly required: boolean;
  readonly position: number;
}

// An ordered item on a checklist template. Value object — mutations return a new instance.
export class ChecklistItem {
  private constructor(private readonly p: ChecklistItemProps) {}

  static create(props: ChecklistItemProps): Result<ChecklistItem, ValidationError> {
    const text = props.text.trim();
    if (text.length === 0) return err(validation("item text is required", "text"));
    if (!isChecklistItemType(props.type)) {
      return err(validation(`unknown item type: ${props.type}`, "type"));
    }
    if (props.position < 0) return err(validation("position cannot be negative", "position"));
    return ok(new ChecklistItem({ ...props, text }));
  }

  get props(): ChecklistItemProps {
    return this.p;
  }
}

export interface ChecklistProps {
  readonly id: ChecklistId;
  readonly orgId: OrgId;
  readonly name: string;
  readonly trade: string;
  readonly stage: ChecklistStage;
  readonly match: readonly string[];
  readonly items: readonly ChecklistItem[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// A reusable checklist template. Header + ordered items. All mutations return a new Checklist
// (immutability); the factory enforces invariants so an invalid Checklist cannot exist.
export class Checklist {
  private constructor(private readonly p: ChecklistProps) {}

  static create(props: ChecklistProps): Result<Checklist, ValidationError> {
    const name = props.name.trim();
    if (name.length === 0) return err(validation("checklist name is required", "name"));
    if (!isChecklistStage(props.stage)) {
      return err(validation(`unknown checklist stage: ${props.stage}`, "stage"));
    }
    // Keep items ordered by position; ties broken by insertion order (stable sort).
    const items = [...props.items].sort((a, b) => a.props.position - b.props.position);
    return ok(new Checklist({ ...props, name, items }));
  }

  // Replace the item collection (re-validated + re-ordered through create).
  withItems(items: readonly ChecklistItem[], now: Date): Checklist {
    const built = Checklist.create({ ...this.p, items, updatedAt: now });
    if (!built.ok) throw new Error(`withItems produced an invalid checklist: ${built.error.message}`);
    return built.value;
  }

  get props(): ChecklistProps {
    return this.p;
  }
}
