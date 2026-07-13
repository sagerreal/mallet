import type { CategoryId, OrgId, Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

export interface CategoryProps {
  readonly id: CategoryId;
  readonly orgId: OrgId;
  readonly parentId: string | null;
  readonly name: string;
  readonly sortOrder: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// A pricebook category — a self-referential tree node used to organise and browse services.
// All mutations return a new Category (immutability); the factory enforces invariants so an
// invalid Category cannot exist.
export class Category {
  private constructor(private readonly p: CategoryProps) {}

  static create(props: CategoryProps): Result<Category, ValidationError> {
    const name = props.name.trim();
    if (name.length === 0) return err(validation("category name is required", "name"));
    return ok(new Category({ ...props, name }));
  }

  // Patch a subset of scalar fields. Undefined = keep current; explicit null is allowed for
  // parentId (a top-level category). All invariants are re-validated through Category.create.
  patch(
    fields: {
      name?: string;
      parentId?: string | null;
      sortOrder?: number;
    },
    now: Date,
  ): Result<Category, ValidationError> {
    return Category.create({
      ...this.p,
      name: fields.name !== undefined ? fields.name : this.p.name,
      parentId: fields.parentId !== undefined ? fields.parentId : this.p.parentId,
      sortOrder: fields.sortOrder !== undefined ? fields.sortOrder : this.p.sortOrder,
      updatedAt: now,
    });
  }

  get props(): CategoryProps {
    return this.p;
  }
}
