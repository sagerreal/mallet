import type { Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";
import type {
  AssemblyComponent,
  AssemblyConfig,
  ComponentBasis,
  UnitRateTier,
} from "./assembly-config";

/**
 * The estimating engine: a measured surface × an assembly's recipe → quote
 * lines, in integer cents. PURE — no I/O, no Date, no randomness — because it
 * is the ONE implementation both seeding paths import: the composer's held
 * traces call it client-side (app/(office)/composer/assembly-held-seed.ts) and
 * persisted captures run it server-side (app/seed-from-capture.ts); the parity
 * test proves the two produce byte-identical lines.
 *
 * Math rules (locked by compute-assembly.test.ts against the researched worked
 * examples):
 *  - material qty = basis × Π(factors), × wasteFactor FIRST, THEN rounded UP to
 *    packSize (you buy waste too, in whole packs); no packSize → 2dp.
 *  - crew_day qty = ceil(basis / unitsPerDay); hourly = basis / unitsPerHour (2dp).
 *  - equipment qty = ceil(source qty / perQuantity) — source read AFTER the
 *    source component's own waste/pack rounding.
 *  - COST_PLUS: every component becomes a line; the margin is applied INTO the
 *    line's per-unit rate at seed time (transparent and editable — never a
 *    hidden adjustment); the component's raw unit cost rides as the line cost.
 *  - UNIT_RATE: ONE customer line — basis qty × the size bracket's rate — with
 *    per-unit cost derived from the full component cost stack; FIXED components
 *    still surface as their own lines (a mobilization fee is not per-sqft).
 *  - Job minimum: when the non-optional total lands below jobMinimumCents the
 *    shortfall is added as its own "Job minimum" line (documented choice: a
 *    separate line keeps every unit rate honest and the adjustment visible and
 *    editable; silently inflating the primary line would corrupt its rate).
 */

export interface AssemblyForCompute {
  readonly name: string;
  readonly measurementBasis: "area" | "perimeter" | "line" | "count";
  readonly pricingMode: "cost_plus" | "unit_rate";
  readonly marginBps: number;
  readonly jobMinimumCents: number;
  readonly config: AssemblyConfig;
}

export interface AssemblyMeasureInput {
  /** The trace/capture's WORKING area (pitch-corrected upstream). */
  readonly areaSqft: number;
  /** Traced edge length; null for manual entries (no polygon). */
  readonly perimeterLnft: number | null;
  /** The surface's display name — leads the UNIT_RATE line's description. */
  readonly sourceName: string;
}

export interface AssemblySeedLine {
  readonly description: string;
  readonly quantity: number;
  /** Per-unit customer rate, cents (margin already applied for COST_PLUS). */
  readonly rateCents: number;
  /** Per-unit cost, cents — same semantics as buildFromMeasurements' SeedLine. */
  readonly costCents: number;
  readonly optional: boolean;
  /** The recipe component this line priced from; null for the minimum line. */
  readonly componentKey: string | null;
}

export interface AssemblyComputeResult {
  readonly lines: readonly AssemblySeedLine[];
  /** Σ round(qty × rate) over non-optional lines, minimum line included. */
  readonly totalCents: number;
  /** Set when the job minimum kicked in — the caller surfaces the notice. */
  readonly minimum: { readonly minimumCents: number; readonly addedCents: number } | null;
  /** Labels of components skipped because the trace lacks their basis (e.g. a
   * perimeter component against a manual capture with no polygon) — surfaced
   * by the caller, never a silent drop. */
  readonly skipped: readonly string[];
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Float-noise guard: 15.999999999 must round up to ONE pack of 16, not 32/2. */
const PACK_EPS = 1e-9;

const roundUpToPack = (qty: number, packSize: number): number =>
  round2(Math.ceil(qty / packSize - PACK_EPS) * packSize);

const applyMargin = (cents: number, marginBps: number): number =>
  Math.round(cents * (1 + marginBps / 10_000));

/** Singular unit for a quantity of one — "1 ton", "2 tons". Unknown units pass through. */
const SINGULAR: Record<string, string> = {
  tons: "ton",
  loads: "load",
  days: "day",
  hours: "hour",
  boxes: "box",
  bags: "bag",
  gals: "gal",
};
const unitLabel = (qty: number, unit: string): string =>
  qty === 1 ? (SINGULAR[unit] ?? unit) : unit;

/** Trim float noise for descriptions: 15.5 → "15.5", 16 → "16". */
const formatQty = (qty: number): string =>
  Number.isInteger(qty) ? String(qty) : String(round2(qty));

interface ComputedComponent {
  readonly component: AssemblyComponent;
  readonly quantity: number;
  /** Per-unit cost in cents. */
  readonly unitCostCents: number;
  /** The parenthetical the description carries — null for plain labels. */
  readonly quantityNote: string | null;
}

function basisValue(basis: ComponentBasis, input: AssemblyMeasureInput): number | null {
  if (basis === "area") return input.areaSqft > 0 ? input.areaSqft : null;
  return input.perimeterLnft !== null && input.perimeterLnft > 0 ? input.perimeterLnft : null;
}

function computeComponent(
  component: AssemblyComponent,
  input: AssemblyMeasureInput,
  quantitiesByKey: ReadonlyMap<string, number>,
): ComputedComponent | "skipped" {
  switch (component.kind) {
    case "material": {
      const basis = basisValue(component.basis, input);
      if (basis === null) return "skipped";
      const chained = component.factors.reduce((acc, factor) => acc * factor, basis);
      const wasted = chained * component.wasteFactor; // waste FIRST…
      const quantity =
        component.packSize !== null
          ? roundUpToPack(wasted, component.packSize) // …THEN pack-round
          : round2(wasted);
      return {
        component,
        quantity,
        unitCostCents: component.unitCostCents,
        quantityNote: `${formatQty(quantity)} ${unitLabel(quantity, component.unit)}`,
      };
    }
    case "labor": {
      const basis = basisValue(component.basis, input);
      if (basis === null) return "skipped";
      if (component.mode === "per_unit") {
        return {
          component,
          quantity: round2(basis),
          unitCostCents: component.rateCents,
          quantityNote: null,
        };
      }
      if (component.mode === "crew_day") {
        // unitsPerDay non-null: enforced by the config schema's superRefine.
        const days = Math.max(1, Math.ceil(basis / (component.unitsPerDay ?? 1) - PACK_EPS));
        return { component, quantity: days, unitCostCents: component.rateCents, quantityNote: null };
      }
      const hours = round2(basis / (component.unitsPerHour ?? 1));
      return { component, quantity: hours, unitCostCents: component.rateCents, quantityNote: null };
    }
    case "equipment": {
      const source =
        "componentKey" in component.source
          ? (quantitiesByKey.get(component.source.componentKey) ?? null)
          : basisValue(component.source.basis, input);
      if (source === null) return "skipped";
      const quantity = Math.max(1, Math.ceil(source / component.perQuantity - PACK_EPS));
      return {
        component,
        quantity,
        unitCostCents: component.rateCents,
        quantityNote: `${formatQty(quantity)} ${unitLabel(quantity, component.unit)}`,
      };
    }
    case "fixed":
      return { component, quantity: 1, unitCostCents: component.amountCents, quantityNote: null };
  }
}

function computeAllComponents(
  config: AssemblyConfig,
  input: AssemblyMeasureInput,
): { computed: ComputedComponent[]; skipped: string[] } {
  const computed: ComputedComponent[] = [];
  const skipped: string[] = [];
  const quantitiesByKey = new Map<string, number>();
  // Two passes so equipment can source any component's quantity regardless of
  // declaration order (the schema already forbids equipment-on-equipment).
  const equipment: AssemblyComponent[] = [];
  for (const component of config.components) {
    if (component.kind === "equipment") {
      equipment.push(component);
      continue;
    }
    const result = computeComponent(component, input, quantitiesByKey);
    if (result === "skipped") {
      skipped.push(component.label);
      continue;
    }
    quantitiesByKey.set(component.key, result.quantity);
    computed.push(result);
  }
  for (const component of equipment) {
    const result = computeComponent(component, input, quantitiesByKey);
    if (result === "skipped") {
      skipped.push(component.label);
      continue;
    }
    computed.push(result);
  }
  return { computed, skipped };
}

const lineDescription = (item: ComputedComponent): string =>
  item.quantityNote === null
    ? item.component.label
    : `${item.component.label} (${item.quantityNote})`;

const lineAmount = (line: AssemblySeedLine): number => Math.round(line.quantity * line.rateCents);

function selectTierRate(tiers: readonly UnitRateTier[], quantity: number): number {
  for (const tier of tiers) {
    if (tier.upToQty === null || quantity <= tier.upToQty) return tier.rateCents;
  }
  // Unreachable: the schema forces the last bracket open-ended; guarded anyway.
  return tiers[tiers.length - 1]?.rateCents ?? 0;
}

function costPlusLines(
  computed: readonly ComputedComponent[],
  marginBps: number,
): AssemblySeedLine[] {
  return computed.map((item) => ({
    description: lineDescription(item),
    quantity: item.quantity,
    rateCents: applyMargin(item.unitCostCents, marginBps),
    costCents: item.unitCostCents,
    optional: item.component.optional === true,
    componentKey: item.component.key,
  }));
}

function unitRateLines(
  assembly: AssemblyForCompute,
  input: AssemblyMeasureInput,
  computed: readonly ComputedComponent[],
): Result<AssemblySeedLine[], ValidationError> {
  const tiers = assembly.config.tiers;
  if (tiers === null || tiers.length === 0) {
    return err(validation(`"${assembly.name}" has no unit-rate brackets`, "config"));
  }
  const quantity =
    assembly.measurementBasis === "area"
      ? round2(input.areaSqft)
      : round2(input.perimeterLnft ?? 0);
  // Non-fixed components are the COST stack behind the single sell line.
  const variableCostCents = computed
    .filter((item) => item.component.kind !== "fixed" && item.component.optional !== true)
    .reduce((sum, item) => sum + Math.round(item.quantity * item.unitCostCents), 0);
  const lines: AssemblySeedLine[] = [
    {
      description: `${input.sourceName} — ${assembly.name}`,
      quantity,
      rateCents: selectTierRate(tiers, quantity),
      costCents: quantity > 0 ? Math.round(variableCostCents / quantity) : 0,
      optional: false,
      componentKey: null,
    },
  ];
  for (const item of computed) {
    if (item.component.kind !== "fixed") continue;
    lines.push({
      description: lineDescription(item),
      quantity: 1,
      rateCents: item.unitCostCents,
      costCents: item.unitCostCents,
      optional: item.component.optional === true,
      componentKey: item.component.key,
    });
  }
  return ok(lines);
}

/**
 * Run one assembly against one measured surface. Errors are for inputs the
 * assembly cannot price (wrong/missing basis, unimplemented basis) — the caller
 * shows the message; a zero-line success is impossible (the config schema
 * requires ≥1 component and the basis is checked up front).
 */
export function computeAssemblySeed(
  assembly: AssemblyForCompute,
  input: AssemblyMeasureInput,
): Result<AssemblyComputeResult, ValidationError> {
  if (assembly.measurementBasis === "line" || assembly.measurementBasis === "count") {
    return err(
      validation(
        `"${assembly.name}" uses a ${assembly.measurementBasis} basis, which traced surfaces can't seed yet`,
        "measurementBasis",
      ),
    );
  }
  if (assembly.measurementBasis === "area" && input.areaSqft <= 0) {
    return err(validation(`${input.sourceName} has no measured area to price "${assembly.name}" from`, "areaSqft"));
  }
  if (
    assembly.measurementBasis === "perimeter" &&
    (input.perimeterLnft === null || input.perimeterLnft <= 0)
  ) {
    return err(
      validation(
        `${input.sourceName} has no measured perimeter to price "${assembly.name}" from`,
        "perimeterLnft",
      ),
    );
  }

  const { computed, skipped } = computeAllComponents(assembly.config, input);

  let lines: AssemblySeedLine[];
  if (assembly.pricingMode === "cost_plus") {
    lines = costPlusLines(computed, assembly.marginBps);
  } else {
    const result = unitRateLines(assembly, input, computed);
    if (!result.ok) return err(result.error);
    lines = result.value;
  }

  // Optional lines are customer add-ons — they don't count toward the minimum.
  const billedTotal = lines
    .filter((line) => !line.optional)
    .reduce((sum, line) => sum + lineAmount(line), 0);

  let minimum: AssemblyComputeResult["minimum"] = null;
  if (assembly.jobMinimumCents > 0 && billedTotal < assembly.jobMinimumCents) {
    const addedCents = assembly.jobMinimumCents - billedTotal;
    minimum = { minimumCents: assembly.jobMinimumCents, addedCents };
    lines = [
      ...lines,
      {
        description: "Job minimum",
        quantity: 1,
        rateCents: addedCents,
        costCents: 0,
        optional: false,
        componentKey: null,
      },
    ];
  }

  const totalCents = lines
    .filter((line) => !line.optional)
    .reduce((sum, line) => sum + lineAmount(line), 0);

  return ok({ lines, totalCents, minimum, skipped });
}
