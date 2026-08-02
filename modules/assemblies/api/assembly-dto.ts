import { z } from "zod";
import { assemblyConfigSchema } from "../domain/assembly-config";
import type { AssemblyListItem } from "../app/list-assemblies";
import type { Assembly } from "../domain/assembly";
import { catalogAssemblyByKey } from "../domain/assembly-defaults";
import { getDialValue } from "../domain/assembly-dials";

/**
 * Wire shapes for v1.assemblies. Money stays integer cents on the wire (the
 * store's dial formatters convert for display); the config blob crosses as its
 * validated schema shape — clients feed it straight into the shared engine
 * (compute-assembly.ts) for held-trace seeding.
 */

export const measurementBasisDTO = z.enum(["area", "perimeter", "line", "count"]);
export const pricingModeDTO = z.enum(["cost_plus", "unit_rate"]);

export const dialViewDTO = z.object({
  key: z.string(),
  label: z.string(),
  format: z.enum(["dollars", "percentBps", "wastePercent", "number"]),
  unitSuffix: z.string().nullable(),
  currentRaw: z.number(),
  defaultRaw: z.number(),
});

export const assemblyItemDTO = z.object({
  id: z.string(),
  catalogKey: z.string().nullable(),
  name: z.string(),
  measurementBasis: measurementBasisDTO,
  pricingMode: pricingModeDTO,
  marginBps: z.number().int(),
  jobMinimumCents: z.number().int(),
  config: assemblyConfigSchema,
  active: z.boolean(),
  isOverride: z.boolean(),
  dials: z.array(dialViewDTO),
});
export type AssemblyItemDTO = z.infer<typeof assemblyItemDTO>;

export const toAssemblyItemDTO = (item: AssemblyListItem): AssemblyItemDTO => ({
  id: item.id,
  catalogKey: item.catalogKey,
  name: item.name,
  measurementBasis: item.measurementBasis,
  pricingMode: item.pricingMode,
  marginBps: item.marginBps,
  jobMinimumCents: item.jobMinimumCents,
  config: item.config,
  active: item.active,
  isOverride: item.isOverride,
  dials: item.dials.map((dial) => ({ ...dial })),
});

/** A persisted row as a list item (save-dial / create responses) — the same
 * shape list returns, so the store reconciles with one mapper. */
export const rowToItemDTO = (assembly: Assembly): AssemblyItemDTO => {
  const p = assembly.props;
  const entry = p.catalogKey === null ? null : catalogAssemblyByKey(p.catalogKey);
  const effective = { marginBps: p.marginBps, jobMinimumCents: p.jobMinimumCents, config: p.config };
  const dials =
    entry === null
      ? []
      : entry.dials.flatMap((dial) => {
          const currentRaw = getDialValue(effective, dial.target);
          const defaultRaw = getDialValue(
            { marginBps: entry.marginBps, jobMinimumCents: entry.jobMinimumCents, config: entry.config },
            dial.target,
          );
          if (currentRaw === null || defaultRaw === null) return [];
          return [
            {
              key: dial.key,
              label: dial.label,
              format: dial.format,
              unitSuffix: dial.unitSuffix ?? null,
              currentRaw,
              defaultRaw,
            },
          ];
        });
  return {
    id: p.id,
    catalogKey: p.catalogKey,
    name: p.name,
    measurementBasis: p.measurementBasis,
    pricingMode: p.pricingMode,
    marginBps: p.marginBps,
    jobMinimumCents: p.jobMinimumCents,
    config: p.config,
    active: p.active,
    isOverride: true,
    dials,
  };
};

export const seedLineDTO = z.object({
  description: z.string(),
  quantity: z.number(),
  rateCents: z.number().int(),
  costCents: z.number().int(),
  optional: z.boolean(),
  componentKey: z.string().nullable(),
});

export const seedResultDTO = z.object({
  lines: z.array(seedLineDTO),
  totalCents: z.number().int(),
  minimum: z
    .object({ minimumCents: z.number().int(), addedCents: z.number().int() })
    .nullable(),
  skipped: z.array(z.string()),
});
export type SeedResultDTO = z.infer<typeof seedResultDTO>;
