import type { TaskId, LeadId, OrgId, Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

export interface TaskProps {
  readonly id: TaskId;
  readonly orgId: OrgId;
  readonly leadId: LeadId | null;
  readonly text: string;
  readonly dueDate: string | null; // ISO date string YYYY-MM-DD
  readonly done: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// A task in the system. All mutations return a new Task (immutability); the factory
// enforces invariants so an invalid Task cannot exist.
export class Task {
  private constructor(private readonly p: TaskProps) {}

  static create(props: TaskProps): Result<Task, ValidationError> {
    const text = props.text.trim();
    if (text.length === 0) return err(validation("task text is required", "text"));
    return ok(new Task({ ...props, text }));
  }

  // Toggle done. Bumps updatedAt. No-op if the value is the same.
  setDone(done: boolean, now: Date): Task {
    if (done === this.p.done) return this;
    return new Task({ ...this.p, done, updatedAt: now });
  }

  // Patch a subset of scalar fields. Undefined = keep current; explicit null is allowed for
  // dueDate and leadId. All invariants re-validated through Task.create so invariants stay
  // in one place.
  patch(
    fields: {
      text?: string;
      dueDate?: string | null;
      leadId?: LeadId | null;
    },
    now: Date,
  ): Result<Task, ValidationError> {
    return Task.create({
      ...this.p,
      text: fields.text !== undefined ? fields.text : this.p.text,
      dueDate: fields.dueDate !== undefined ? fields.dueDate : this.p.dueDate,
      leadId: fields.leadId !== undefined ? fields.leadId : this.p.leadId,
      updatedAt: now,
    });
  }

  get props(): TaskProps {
    return this.p;
  }
}
