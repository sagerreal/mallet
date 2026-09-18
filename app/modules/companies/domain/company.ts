import type { CompanyId, OrgId, Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

export interface CompanyProps {
  readonly id: CompanyId;
  readonly orgId: OrgId;
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly website: string | null;
  readonly address: string | null;
  readonly notes: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// A B2B company account. All mutations return a new Company (immutability); the factory
// enforces invariants so an invalid Company cannot exist.
export class Company {
  private constructor(private readonly p: CompanyProps) {}

  static create(props: CompanyProps): Result<Company, ValidationError> {
    const name = props.name.trim();
    if (name.length === 0) return err(validation("company name is required", "name"));
    return ok(new Company({ ...props, name }));
  }

  // Patch a subset of scalar fields. Undefined = keep current; explicit null is allowed for all
  // optional fields. All invariants are re-validated through Company.create.
  patch(
    fields: {
      name?: string;
      phone?: string | null;
      email?: string | null;
      website?: string | null;
      address?: string | null;
      notes?: string | null;
    },
    now: Date,
  ): Result<Company, ValidationError> {
    return Company.create({
      ...this.p,
      name: fields.name !== undefined ? fields.name : this.p.name,
      phone: fields.phone !== undefined ? fields.phone : this.p.phone,
      email: fields.email !== undefined ? fields.email : this.p.email,
      website: fields.website !== undefined ? fields.website : this.p.website,
      address: fields.address !== undefined ? fields.address : this.p.address,
      notes: fields.notes !== undefined ? fields.notes : this.p.notes,
      updatedAt: now,
    });
  }

  get props(): CompanyProps {
    return this.p;
  }
}
