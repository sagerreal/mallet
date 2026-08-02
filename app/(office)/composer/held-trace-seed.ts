/**
 * app/(office)/composer/held-trace-seed.ts
 *
 * Client-side seeding for traces HELD on the quote (lib/measure/held-trace.ts)
 * — surfaces traced from the composer before any job exists. There is no
 * capture row to run v1.quoting.buildFromMeasurements against, so this module
 * mirrors the server's site-seeding rules exactly (modules/quoting/app/
 * build-from-measurements.ts; parity proven in held-trace-seed.test.ts against
 * the real use-case):
 *
 *   - source label: pitched surfaces carry their pitch — "Main roof at 6/12"
 *   - per measured kind (site_sqft, site_lnft): the lowest-position ACTIVE
 *     priced service, tie-broken (position, name, id) independent of input order
 *   - line description "SOURCE — Service name", quantity = the measured value,
 *     rate/cost PER-UNIT in cents straight off the service
 *   - zero quantities seed nothing; a kind with no priced service becomes a
 *     gap the caller surfaces (never a silent no-op)
 *
 * The store keeps pricebook money in DOLLARS (lib/store/types.ts) — the exact
 * cents the server would use are recovered via Math.round(dollars * 100), the
 * same conversion the pricebook mapper applied on the way in.
 */

import type { Service } from "@/lib/store/types";
import type { HeldTrace } from "@/lib/measure/held-trace";
import type { MeasurementSeedLine } from "./composer-state";

type SiteKind = "site_sqft" | "site_lnft";

/** Office-facing labels for the gap notice — mirrors the server's KIND_LABELS. */
const SITE_KIND_LABELS: Record<SiteKind, string> = {
  site_sqft: "Site area",
  site_lnft: "Site perimeter",
};

/** The line's leading source label — pitched surfaces name their pitch. */
export function heldTraceSourceName(trace: Pick<HeldTrace, "name" | "surface" | "pitchRise">): string {
  return trace.surface === "pitched" && trace.pitchRise !== null
    ? `${trace.name} at ${trace.pitchRise}/12`
    : trace.name;
}

/**
 * Mirrors the server's isLowerRanked: position, then name, then id — explicit
 * because two UI-created services both default to position 0, and the winner
 * must not depend on the order the services happen to sit in the store.
 */
function isLowerRanked(a: Service, b: Service): boolean {
  if (a.position !== b.position) return a.position < b.position;
  if (a.name !== b.name) return a.name < b.name;
  return a.id < b.id;
}

/** The service a kind seeds from — lowest-ranked ACTIVE service priced against it. */
export function serviceForKind(services: readonly Service[], kind: SiteKind): Service | null {
  let best: Service | null = null;
  for (const svc of services) {
    if (!svc.active || svc.measuredBy !== kind) continue;
    if (best === null || isLowerRanked(svc, best)) best = svc;
  }
  return best;
}

export interface HeldTraceSeedResult {
  readonly lines: MeasurementSeedLine[];
  /** Labels of measured kinds this trace offers but no active service prices. */
  readonly gaps: readonly string[];
}

/**
 * One held trace → its seed lines, same shape buildFromMeasurements returns
 * (cents, per-unit). Quantities are the trace's 2dp working figures — exactly
 * what the server would read back from numeric(12,2) columns.
 */
export function seedFromHeldTrace(
  trace: HeldTrace,
  services: readonly Service[],
): HeldTraceSeedResult {
  const sourceName = heldTraceSourceName(trace);
  const quantities: { kind: SiteKind; value: number }[] = [
    { kind: "site_sqft", value: trace.areaSqft },
    { kind: "site_lnft", value: trace.perimeterLnft },
  ];

  const lines: MeasurementSeedLine[] = [];
  const gaps: string[] = [];
  for (const { kind, value } of quantities) {
    if (value === 0) continue; // nothing to charge for
    const service = serviceForKind(services, kind);
    if (!service) {
      gaps.push(SITE_KIND_LABELS[kind]);
      continue;
    }
    lines.push({
      description: `${sourceName} — ${service.name}`,
      quantity: value,
      rateCents: Math.round(service.unitPrice * 100),
      costCents: Math.round(service.cost * 100),
    });
  }
  return { lines, gaps };
}
