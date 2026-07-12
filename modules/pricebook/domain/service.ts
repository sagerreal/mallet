import type { OrgId, Result, ServiceId, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

export interface ServiceProps {
  readonly id: ServiceId;
  readonly orgId: OrgId;
  readonly categoryId: string | null;
  readonly code: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly unitPriceCents: number;
  readonly costCents: number;
  readonly laborHours: number | null;
  readonly taxable: boolean;
  readonly warrantyText: string | null;
  readonly imageUrl: string | null;
  readonly isAddon: boolean;
  readonly active: boolean;
  readonly position: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// A sellable pricebook line — the task→price "Service". All mutations return a new Service
// (immutability); the factory enforces invariants so an invalid Service cannot exist.
export class Service {
  private constructor(private readonly p: ServiceProps) {}

  static create(props: ServiceProps): Result<Service, ValidationError> {
    const name = props.name.trim();
    if (name.length === 0) return err(validation("service name is required", "name"));
    if (props.unitPriceCents < 0) {
      return err(validation("unit price must be ≥ 0", "unitPriceCents"));
    }
    if (props.costCents < 0) {
      return err(validation("cost must be ≥ 0", "costCents"));
    }
    return ok(new Service({ ...props, name }));
  }

  // Patch a subset of scalar fields. Undefined = keep current; explicit null is allowed for all
  // nullable fields. All invariants are re-validated through Service.create.
  patch(
    fields: {
      name?: string;
      categoryId?: string | null;
      code?: string | null;
      description?: string | null;
      unitPriceCents?: number;
      costCents?: number;
      laborHours?: number | null;
      taxable?: boolean;
      warrantyText?: string | null;
      imageUrl?: string | null;
      isAddon?: boolean;
      active?: boolean;
      position?: number;
    },
    now: Date,
  ): Result<Service, ValidationError> {
    return Service.create({
      ...this.p,
      name: fields.name !== undefined ? fields.name : this.p.name,
      categoryId: fields.categoryId !== undefined ? fields.categoryId : this.p.categoryId,
      code: fields.code !== undefined ? fields.code : this.p.code,
      description: fields.description !== undefined ? fields.description : this.p.description,
      unitPriceCents:
        fields.unitPriceCents !== undefined ? fields.unitPriceCents : this.p.unitPriceCents,
      costCents: fields.costCents !== undefined ? fields.costCents : this.p.costCents,
      laborHours: fields.laborHours !== undefined ? fields.laborHours : this.p.laborHours,
      taxable: fields.taxable !== undefined ? fields.taxable : this.p.taxable,
      warrantyText:
        fields.warrantyText !== undefined ? fields.warrantyText : this.p.warrantyText,
      imageUrl: fields.imageUrl !== undefined ? fields.imageUrl : this.p.imageUrl,
      isAddon: fields.isAddon !== undefined ? fields.isAddon : this.p.isAddon,
      active: fields.active !== undefined ? fields.active : this.p.active,
      position: fields.position !== undefined ? fields.position : this.p.position,
      updatedAt: now,
    });
  }

  get props(): ServiceProps {
    return this.p;
  }
}
