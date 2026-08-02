import type { AssemblyId, OrgId, Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";
import type { AssemblyConfig } from "./assembly-config";
import { parseAssemblyConfig } from "./assembly-config";

/**
 * An assembly — a sellable scope of work ("Driveway replacement, 3-inch") whose
 * price resolves from measured geometry through a component recipe instead of a
 * flat sqft rate. Persisted per org (an override of a shipped catalog default,
 * or a custom scope); the recipe itself lives in the versioned config blob
 * (assembly-config.ts), identity/basis/mode/minimum in columns.
 *
 * measurementBasis: "area"/"perimeter" price from the surface's working
 * area/traced perimeter; "line" prices from the roof's classed edge linears
 * (the tracer's eave/rake/ridge/hip/valley totals); "count" prices per dialed
 * unit. A count assembly cannot be UNIT_RATE — a count of parts has no single
 * sell line — rejected here and mirrored in the engine's gate.
 */

export const MEASUREMENT_BASES = ["area", "perimeter", "line", "count"] as const;
export type MeasurementBasis = (typeof MEASUREMENT_BASES)[number];

export const PRICING_MODES = ["cost_plus", "unit_rate"] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

/** Margin sanity cap: 400% cost-plus is a typo, not a price. */
const MAX_MARGIN_BPS = 40_000;
const MAX_MINIMUM_CENTS = 100_000_000;

export interface AssemblyProps {
  readonly id: AssemblyId;
  readonly orgId: OrgId;
  /** Which shipped default this row overrides; null = org-authored custom. */
  readonly catalogKey: string | null;
  readonly name: string;
  readonly measurementBasis: MeasurementBasis;
  readonly pricingMode: PricingMode;
  readonly marginBps: number;
  readonly jobMinimumCents: number;
  readonly config: AssemblyConfig;
  readonly active: boolean;
  readonly position: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class Assembly {
  private constructor(private readonly p: AssemblyProps) {}

  static create(props: AssemblyProps): Result<Assembly, ValidationError> {
    const name = props.name.trim();
    if (name.length === 0) return err(validation("assembly name is required", "name"));
    if (name.length > 120) return err(validation("assembly name is too long (120 max)", "name"));
    if (!MEASUREMENT_BASES.includes(props.measurementBasis)) {
      return err(validation("unrecognized measurement basis", "measurementBasis"));
    }
    if (!PRICING_MODES.includes(props.pricingMode)) {
      return err(validation("unrecognized pricing mode", "pricingMode"));
    }
    if (props.measurementBasis === "count" && props.pricingMode === "unit_rate") {
      return err(
        validation("a count assembly can't sell one unit-rate line — price it cost-plus", "measurementBasis"),
      );
    }
    if (!Number.isInteger(props.marginBps) || props.marginBps < 0 || props.marginBps > MAX_MARGIN_BPS) {
      return err(validation("margin must be between 0% and 400%", "marginBps"));
    }
    if (
      !Number.isInteger(props.jobMinimumCents) ||
      props.jobMinimumCents < 0 ||
      props.jobMinimumCents > MAX_MINIMUM_CENTS
    ) {
      return err(validation("job minimum must be a non-negative amount", "jobMinimumCents"));
    }
    const config = parseAssemblyConfig(props.config);
    if (!config.ok) return err(config.error);
    if (props.pricingMode === "unit_rate" && config.value.tiers === null) {
      return err(validation("a unit-rate assembly needs at least one rate bracket", "config"));
    }
    return ok(new Assembly({ ...props, name, config: config.value }));
  }

  /** Patch a subset of fields; undefined = keep. Invariants re-run via create. */
  patch(
    fields: {
      name?: string;
      marginBps?: number;
      jobMinimumCents?: number;
      config?: AssemblyConfig;
      active?: boolean;
      position?: number;
    },
    now: Date,
  ): Result<Assembly, ValidationError> {
    return Assembly.create({
      ...this.p,
      name: fields.name !== undefined ? fields.name : this.p.name,
      marginBps: fields.marginBps !== undefined ? fields.marginBps : this.p.marginBps,
      jobMinimumCents:
        fields.jobMinimumCents !== undefined ? fields.jobMinimumCents : this.p.jobMinimumCents,
      config: fields.config !== undefined ? fields.config : this.p.config,
      active: fields.active !== undefined ? fields.active : this.p.active,
      position: fields.position !== undefined ? fields.position : this.p.position,
      updatedAt: now,
    });
  }

  get props(): AssemblyProps {
    return this.p;
  }
}
