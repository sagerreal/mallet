import { z } from "zod";
import type { Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

/**
 * The assembly's component recipe — the versioned JSONB config blob persisted on
 * an assembly row and shipped in the default catalog. Validated HERE (one zod
 * schema, one version gate) at every boundary that touches a blob: the tRPC
 * input, the DB read mapper, and the catalog's own unit test. The engine
 * (compute-assembly.ts) only ever sees a parsed AssemblyConfig.
 *
 * Version 1 shapes. A future version bumps ASSEMBLY_CONFIG_VERSION, adds a
 * migration path in parseAssemblyConfig, and never mutates v1 semantics —
 * quotes seeded under v1 stay reproducible.
 */

export const ASSEMBLY_CONFIG_VERSION = 1;

/** The classed roof linears a LINE component can reference — the exact keys of
 * the tracer's derived edge totals (lib/measure/edge-classes.ts EdgeTotalsFt). */
export const EDGE_CLASS_KEYS = ["eaveFt", "rakeFt", "ridgeFt", "hipFt", "valleyFt"] as const;
export const edgeClassKeySchema = z.enum(EDGE_CLASS_KEYS);
export type EdgeClassKey = z.infer<typeof edgeClassKeySchema>;

/**
 * Which measured quantity a component consumes (v1 ADDITIVE — the two string
 * literals are the original shapes, so every pre-roofing blob stays valid):
 *  - "area" / "perimeter": the surface's working area / traced perimeter
 *  - { edges: [...] }: the SUM of the named classed roof linears — a LINE
 *    quantity ("eaves + rakes" feeds starter strip). An unclassified surface
 *    cannot feed it (the component skips LOUDLY as a named gap); a classified
 *    surface where the named classes total zero owes nothing (no valleys → no
 *    valley metal) and the component is omitted.
 *  - { count: n }: a COUNT the office dials by hand (pipe boots — the tracer
 *    doesn't count penetrations in v1). 0 = configured off, omitted silently.
 */
export const componentBasisSchema = z.union([
  z.enum(["area", "perimeter"]),
  z.object({
    edges: z
      .array(edgeClassKeySchema)
      .min(1)
      .max(5)
      .refine((keys) => new Set(keys).size === keys.length, {
        message: "edge classes in a sum must be unique",
      }),
  }),
  z.object({ count: z.number().int().min(0).max(1000) }),
]);
export type ComponentBasis = z.infer<typeof componentBasisSchema>;

const keySchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9_]+$/, "component keys are snake_case identifiers");
const labelSchema = z.string().min(1).max(120);
const centsSchema = z.number().int().min(0).max(100_000_000);

/**
 * MATERIAL: quantity = basis × Π(factors) × wasteFactor, rounded UP to packSize
 * (waste FIRST, pack-round SECOND — you buy waste too, and you buy whole packs
 * of it). factors are the conversion chain, e.g. asphalt tons per sqft:
 * [depth_in, 145/24000]. unitCostCents is the per-unit cost.
 */
export const materialComponentSchema = z.object({
  kind: z.literal("material"),
  key: keySchema,
  label: labelSchema,
  basis: componentBasisSchema,
  factors: z.array(z.number().finite().positive().max(1_000_000)).min(1).max(6),
  wasteFactor: z.number().min(1).max(3),
  /** v1 additive: waste resolves from the config's wasteByComplexity table and
   * the surface's derived complexity instead of the flat wasteFactor (which
   * stays as the fallback when the surface carries no classification). */
  usesDerivedWaste: z.boolean().optional(),
  packSize: z.number().positive().max(1_000_000).nullable(),
  /** v1 additive: whole units added AFTER pack rounding — "drip edge sticks,
   * plus two" is bought as spares, not as coverage. */
  extraUnits: z.number().int().min(0).max(100).optional(),
  unit: z.string().min(1).max(20),
  unitCostCents: centsSchema,
  optional: z.boolean().optional(),
});
export type MaterialComponent = z.infer<typeof materialComponentSchema>;

/**
 * LABOR, three production shapes:
 *  - per_unit: quantity = basis value; rateCents per basis unit ($1.75/sqft demo)
 *  - crew_day: quantity = ceil(basis / unitsPerDay); rateCents per crew-day
 *  - hourly:   quantity = basis / unitsPerHour (2dp); rateCents per crew-hour
 */
export const laborComponentSchema = z
  .object({
    kind: z.literal("labor"),
    key: keySchema,
    label: labelSchema,
    basis: componentBasisSchema,
    /** v1 additive: conversion chain applied to the basis BEFORE the mode math —
     * tear-off priced per SQUARE is basis sqft × [1/100]. Absent = [1]. */
    factors: z.array(z.number().finite().positive().max(1_000_000)).min(1).max(6).optional(),
    mode: z.enum(["per_unit", "crew_day", "hourly"]),
    unitsPerDay: z.number().positive().max(1_000_000).nullable(),
    unitsPerHour: z.number().positive().max(1_000_000).nullable(),
    rateCents: centsSchema,
    optional: z.boolean().optional(),
  })
  .superRefine((c, ctx) => {
    if (c.mode === "crew_day" && c.unitsPerDay === null) {
      ctx.addIssue({ code: "custom", message: `labor "${c.key}": crew_day needs unitsPerDay` });
    }
    if (c.mode === "hourly" && c.unitsPerHour === null) {
      ctx.addIssue({ code: "custom", message: `labor "${c.key}": hourly needs unitsPerHour` });
    }
  });
export type LaborComponent = z.infer<typeof laborComponentSchema>;

/**
 * EQUIPMENT/TRUCKING: quantity = ceil(source quantity / perQuantity) — e.g.
 * ceil(asphalt tons / 20 tons-per-load) hauling loads. The source is another
 * component's COMPUTED quantity (after waste + pack rounding) or a basis value.
 */
export const equipmentComponentSchema = z.object({
  kind: z.literal("equipment"),
  key: keySchema,
  label: labelSchema,
  source: z.union([
    z.object({ componentKey: keySchema }),
    z.object({ basis: componentBasisSchema }),
  ]),
  perQuantity: z.number().positive().max(1_000_000),
  unit: z.string().min(1).max(20),
  rateCents: centsSchema,
  optional: z.boolean().optional(),
});
export type EquipmentComponent = z.infer<typeof equipmentComponentSchema>;

/** FIXED: one flat amount regardless of size — mobilization, permits. */
export const fixedComponentSchema = z.object({
  kind: z.literal("fixed"),
  key: keySchema,
  label: labelSchema,
  amountCents: centsSchema,
  optional: z.boolean().optional(),
});
export type FixedComponent = z.infer<typeof fixedComponentSchema>;

export const assemblyComponentSchema = z.discriminatedUnion("kind", [
  materialComponentSchema,
  laborComponentSchema,
  equipmentComponentSchema,
  fixedComponentSchema,
]);
export type AssemblyComponent = z.infer<typeof assemblyComponentSchema>;

/** UNIT_RATE size bracket: the rate that applies while quantity ≤ upToQty.
 * The catch-all bracket carries upToQty null and must sit last. */
export const unitRateTierSchema = z.object({
  upToQty: z.number().positive().max(100_000_000).nullable(),
  rateCents: centsSchema,
});
export type UnitRateTier = z.infer<typeof unitRateTierSchema>;

/** v1 additive: the derived-waste table — the multiplier a usesDerivedWaste
 * material applies, picked by the surface's complexity tier (simple gable /
 * some hips or valleys / cut-up). Dial-overridable per tier. */
export const wasteByComplexitySchema = z.object({
  simple: z.number().min(1).max(3),
  moderate: z.number().min(1).max(3),
  cutUp: z.number().min(1).max(3),
});
export type WasteByComplexity = z.infer<typeof wasteByComplexitySchema>;

export const assemblyConfigSchema = z
  .object({
    version: z.literal(ASSEMBLY_CONFIG_VERSION),
    /** v1 additive: the surface kind this recipe prices — a shingle reroof is
     * meaningless on a flat driveway. Absent = any surface (all pre-roofing
     * blobs). Enforced by the engine AND the composer's picker gating. */
    surface: z.enum(["flat", "pitched"]).optional(),
    /** v1 additive: see wasteByComplexitySchema. Required when any component
     * sets usesDerivedWaste (the superRefine below holds that invariant). */
    wasteByComplexity: wasteByComplexitySchema.optional(),
    components: z.array(assemblyComponentSchema).min(1).max(20),
    /** UNIT_RATE brackets; null for COST_PLUS assemblies. */
    tiers: z.array(unitRateTierSchema).min(1).max(10).nullable(),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    for (const component of config.components) {
      if (seen.has(component.key)) {
        ctx.addIssue({ code: "custom", message: `duplicate component key "${component.key}"` });
      }
      seen.add(component.key);
    }
    for (const component of config.components) {
      if (component.kind === "material" && component.usesDerivedWaste === true && config.wasteByComplexity === undefined) {
        ctx.addIssue({
          code: "custom",
          message: `material "${component.key}" derives waste from complexity but the config has no wasteByComplexity table`,
        });
      }
    }
    for (const component of config.components) {
      if (component.kind !== "equipment") continue;
      const componentSource = component.source;
      if (!("componentKey" in componentSource)) continue;
      const source = config.components.find((c) => c.key === componentSource.componentKey);
      if (!source) {
        ctx.addIssue({
          code: "custom",
          message: `equipment "${component.key}" references unknown component "${componentSource.componentKey}"`,
        });
      } else if (source.kind === "equipment" || source.kind === "fixed") {
        ctx.addIssue({
          code: "custom",
          message: `equipment "${component.key}" must source a material or labor quantity`,
        });
      }
    }
    if (config.tiers !== null) {
      config.tiers.forEach((tier, i) => {
        const isLast = i === config.tiers!.length - 1;
        if (isLast && tier.upToQty !== null) {
          ctx.addIssue({ code: "custom", message: "the last rate bracket must be open-ended" });
        }
        if (!isLast && tier.upToQty === null) {
          ctx.addIssue({ code: "custom", message: "only the last rate bracket can be open-ended" });
        }
        const next = config.tiers?.[i + 1];
        if (!isLast && tier.upToQty !== null && next !== undefined) {
          if (next.upToQty !== null && next.upToQty <= tier.upToQty) {
            ctx.addIssue({ code: "custom", message: "rate brackets must grow in size" });
          }
        }
      });
    }
  });
export type AssemblyConfig = z.infer<typeof assemblyConfigSchema>;

/**
 * Boundary parse for an untrusted config blob (tRPC input, DB row, catalog
 * self-check). Returns Result — never throws for bad data.
 */
export function parseAssemblyConfig(raw: unknown): Result<AssemblyConfig, ValidationError> {
  const parsed = assemblyConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.join(".") ?? "";
    return err(
      validation(`assembly config invalid${path ? ` at ${path}` : ""}: ${first?.message ?? "unknown"}`, "config"),
    );
  }
  return ok(parsed.data);
}
