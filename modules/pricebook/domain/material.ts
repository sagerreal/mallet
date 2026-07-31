import type { MaterialId, OrgId, Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

export interface MaterialProps {
  readonly id: MaterialId;
  readonly orgId: OrgId;
  readonly categoryId: string | null;
  readonly code: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly unitCostCents: number;
  /** SELL side — stored, never quote-time-computed. 'rule' derives it from cost via the
   * org's markup bands; 'manual' means the shop typed it and cost edits never touch it. */
  readonly unitPriceCents: number;
  readonly pricingMode: "rule" | "manual";
  readonly unitOfMeasure: string;
  readonly markupBps: number | null;
  readonly taxable: boolean;
  readonly vendor: string | null;
  readonly active: boolean;
  readonly position: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// A pricebook material — a hidden cost ingredient (a part/component) attached to a Service by
// quantity to build its cost basis. Not shown to the customer. All mutations return a new
// Material (immutability); the factory enforces invariants so an invalid Material cannot exist.
export class Material {
  private constructor(private readonly p: MaterialProps) {}

  static create(props: MaterialProps): Result<Material, ValidationError> {
    const name = props.name.trim();
    if (name.length === 0) return err(validation("material name is required", "name"));
    if (props.unitCostCents < 0) {
      return err(validation("unit cost must be ≥ 0", "unitCostCents"));
    }
    if (props.markupBps !== null && props.markupBps < 0) {
      return err(validation("markup must be ≥ 0", "markupBps"));
    }
    if (props.unitPriceCents < 0) {
      return err(validation("sell price must be ≥ 0", "unitPriceCents"));
    }
    return ok(new Material({ ...props, name }));
  }

  // Patch a subset of scalar fields. Undefined = keep current; explicit null is allowed for all
  // nullable fields. All invariants are re-validated through Material.create.
  patch(
    fields: {
      categoryId?: string | null;
      code?: string | null;
      name?: string;
      description?: string | null;
      unitCostCents?: number;
      unitPriceCents?: number;
      pricingMode?: "rule" | "manual";
      unitOfMeasure?: string;
      markupBps?: number | null;
      taxable?: boolean;
      vendor?: string | null;
      active?: boolean;
      position?: number;
    },
    now: Date,
  ): Result<Material, ValidationError> {
    return Material.create({
      ...this.p,
      categoryId: fields.categoryId !== undefined ? fields.categoryId : this.p.categoryId,
      code: fields.code !== undefined ? fields.code : this.p.code,
      name: fields.name !== undefined ? fields.name : this.p.name,
      description: fields.description !== undefined ? fields.description : this.p.description,
      unitCostCents:
        fields.unitCostCents !== undefined ? fields.unitCostCents : this.p.unitCostCents,
      unitPriceCents:
        fields.unitPriceCents !== undefined ? fields.unitPriceCents : this.p.unitPriceCents,
      pricingMode: fields.pricingMode !== undefined ? fields.pricingMode : this.p.pricingMode,
      unitOfMeasure:
        fields.unitOfMeasure !== undefined ? fields.unitOfMeasure : this.p.unitOfMeasure,
      markupBps: fields.markupBps !== undefined ? fields.markupBps : this.p.markupBps,
      taxable: fields.taxable !== undefined ? fields.taxable : this.p.taxable,
      vendor: fields.vendor !== undefined ? fields.vendor : this.p.vendor,
      active: fields.active !== undefined ? fields.active : this.p.active,
      position: fields.position !== undefined ? fields.position : this.p.position,
      updatedAt: now,
    });
  }

  get props(): MaterialProps {
    return this.p;
  }
}
