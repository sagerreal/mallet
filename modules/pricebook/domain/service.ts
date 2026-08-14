import type { OrgId, Result, ServiceId, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";
// Type-only import through the module's sanctioned barrel (a deep `.../domain/derive-painting`
// import is blocked by the eslint import-boundary rule, and would also be the wrong call: the
// barrel re-exports createMeasurementRouter, which pulls the config validator and throws
// without DB env in unit tests). `import type` is erased at compile time — verbatimModuleSyntax
// guarantees no runtime import statement survives — so this never triggers that barrel
// evaluation despite going through the same specifier.
import type { PaintingQuantityKind, SiteQuantityKind, TrimAreaKind } from "@mallet/measurements";

export type { PaintingQuantityKind, SiteQuantityKind, TrimAreaKind };

// Compile-time pin: if derive-painting.ts's PaintingQuantityKind ever adds/removes a literal,
// this exhaustiveness map fails to typecheck (`Record<PaintingQuantityKind, true>` requires
// every member present, and an extra key here would be a type error too) — stronger than a
// runtime-only assertion, and it does not require importing the measurements module barrel.
// This is the single source of the membership list; MEASURED_BY_KINDS is derived from it.
const MEASURED_BY_KIND_SET: Record<PaintingQuantityKind, true> = {
  walls_sqft: true,
  ceiling_sqft: true,
  soffit_sqft: true,
  baseboard_lnft: true,
  crown_lnft: true,
  doors_count: true,
  windows_count: true,
};

// Same compile-time pin for the site (aerial takeoff) kinds — site-quantities-reader.ts is
// the source of the membership.
const SITE_KIND_SET: Record<SiteQuantityKind, true> = {
  site_sqft: true,
  site_lnft: true,
};

// And for the trim AREAS. These are a pricing basis, not a room quantity: nothing writes a
// `baseboard_sqft` row and no scan derives one — the number is computed from the measured run
// and the typed height on the way out. A shop points a per-sq-ft trim service at these; a shop
// that bids trim by the foot never sees them.
const TRIM_AREA_KIND_SET: Record<TrimAreaKind, true> = {
  baseboard_sqft: true,
  crown_sqft: true,
};

// The room-quantity kinds a measured-by service can be priced per unit of, plus the two trim
// areas those runs turn into — the list the pricebook UI offers.
export const MEASURED_BY_KINDS: readonly (PaintingQuantityKind | TrimAreaKind)[] = [
  ...(Object.keys(MEASURED_BY_KIND_SET) as PaintingQuantityKind[]),
  ...(Object.keys(TRIM_AREA_KIND_SET) as TrimAreaKind[]),
];

/** The measured quantities (room, trim area OR site) a per-unit service can price against. */
export type MeasuredQuantityKind = PaintingQuantityKind | TrimAreaKind | SiteQuantityKind;

/** What a service's price is PER: a measured room/site quantity, or an hour of labor. */
export type ServicePricedBy = MeasuredQuantityKind | "hour";

/**
 * Whether this build recognizes a stored measured_by value.
 *
 * Exported for the READ boundary. The database is shared across branches, so a row can legally
 * carry a value from a build newer than this one; the mapper needs to ask that question rather
 * than treating the answer as corruption. See service-mapper.ts.
 */
export const isMeasuredByKind = (v: string): v is ServicePricedBy =>
  v === "hour" ||
  Object.prototype.hasOwnProperty.call(MEASURED_BY_KIND_SET, v) ||
  Object.prototype.hasOwnProperty.call(TRIM_AREA_KIND_SET, v) ||
  Object.prototype.hasOwnProperty.call(SITE_KIND_SET, v);

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
  // When set, unitPriceCents is a PER-UNIT rate against this measured room quantity (e.g. a
  // painting wall service priced per sqft) rather than a flat price. Null preserves today's
  // flat-price semantics unchanged.
  readonly measuredBy: ServicePricedBy | null;
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
    if (props.measuredBy !== null && !isMeasuredByKind(props.measuredBy)) {
      return err(validation("measuredBy must be a recognized room quantity kind", "measuredBy"));
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
      measuredBy?: ServicePricedBy | null;
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
      measuredBy: fields.measuredBy !== undefined ? fields.measuredBy : this.p.measuredBy,
      updatedAt: now,
    });
  }

  get props(): ServiceProps {
    return this.p;
  }
}
