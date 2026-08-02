import { asAssemblyId, asOrgId } from "@mallet/shared/types";
import { assemblies } from "@mallet/shared/db/schema";
import { Assembly } from "../domain/assembly";
import { MEASUREMENT_BASES, PRICING_MODES } from "../domain/assembly";
import type { MeasurementBasis, PricingMode } from "../domain/assembly";
import { parseAssemblyConfig } from "../domain/assembly-config";

// The persistence row shape, inferred from the schema.
export type AssemblyRow = typeof assemblies.$inferSelect;

const isBasis = (v: string): v is MeasurementBasis =>
  (MEASUREMENT_BASES as readonly string[]).includes(v);
const isMode = (v: string): v is PricingMode => (PRICING_MODES as readonly string[]).includes(v);

/**
 * Reconstruct a domain Assembly from a DB row. The jsonb config blob is
 * UNTRUSTED at this boundary (schema drift, a hand-edited row) — it re-runs
 * the versioned schema; corrupt data throws rather than silently coercing
 * (same contract as company-mapper).
 */
export const toDomain = (row: AssemblyRow): Assembly => {
  if (!isBasis(row.measurementBasis)) {
    throw new Error(`corrupt assembly ${row.id}: basis "${row.measurementBasis}"`);
  }
  if (!isMode(row.pricingMode)) {
    throw new Error(`corrupt assembly ${row.id}: pricing mode "${row.pricingMode}"`);
  }
  const config = parseAssemblyConfig(row.config);
  if (!config.ok) {
    throw new Error(`corrupt assembly ${row.id}: ${config.error.message}`);
  }
  const result = Assembly.create({
    id: asAssemblyId(row.id),
    orgId: asOrgId(row.orgId),
    catalogKey: row.catalogKey,
    name: row.name,
    measurementBasis: row.measurementBasis,
    pricingMode: row.pricingMode,
    marginBps: row.marginBps,
    jobMinimumCents: row.jobMinimumCents,
    config: config.value,
    active: row.active,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) {
    throw new Error(`corrupt assembly ${row.id}: ${result.error.message}`);
  }
  return result.value;
};
