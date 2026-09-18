import type { Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";
import type {
  AssemblyComponent,
  AssemblyConfig,
  ComponentBasis,
  EdgeClassKey,
  UnitRateTier,
  WasteByComplexity,
} from "./assembly-config";
import { EDGE_CLASS_KEYS } from "./assembly-config";

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
 *    packSize (you buy waste too, in whole packs), THEN + extraUnits (spares
 *    are whole sticks on top); no packSize → 2dp.
 *  - a component's basis is area, perimeter, a SUM of classed roof linears
 *    ({edges:[…]}, plan-view feet — the recipes price waste over the classed
 *    totals rather than slope-correcting each linear), or a dialed count
 *    ({count:n}). Unclassified surface + edges basis = a LOUD named gap
 *    (skipped, need "edges"); classified-but-zero linears or a zero count =
 *    the component simply doesn't apply (omitted, deliberate).
 *  - a usesDerivedWaste material resolves its waste from the config's
 *    wasteByComplexity table by the surface's complexity tier — simple (no
 *    hips/valleys), moderate (some), cutUp (hips AND valleys, or either ≥3);
 *    an unclassified surface falls back to the component's flat wasteFactor.
 *    The applied derived waste is reported (result.derivedWaste) so the UI can
 *    say WHY the quantity grew — never a hidden markup.
 *  - labor: optional factors chain converts the basis first (per-square rates
 *    are basis sqft × [1/100]); then per_unit qty = converted basis;
 *    crew_day = ceil(basis / unitsPerDay); hourly = basis / unitsPerHour (2dp).
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

/** Structural twins of lib/measure/edge-classes' EdgeTotalsFt/RoofComplexity —
 * declared here so the domain layer stays import-free of the app tree; the
 * callers' assignments are the compile-time parity check if either drifts. */
export interface AssemblyEdgeTotals {
  readonly eaveFt: number;
  readonly rakeFt: number;
  readonly ridgeFt: number;
  readonly hipFt: number;
  readonly valleyFt: number;
}
export interface AssemblyComplexity {
  readonly hips: number;
  readonly valleys: number;
  readonly cutUp: boolean;
}

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
  /** Flat or pitched — pitched-only recipes refuse a flat surface up front. */
  readonly surface: "flat" | "pitched";
  /** Per-class roof linears (plan-view ft); null when unclassified. */
  readonly edges: AssemblyEdgeTotals | null;
  /** Hip/valley counts for waste derivation; null when unclassified. */
  readonly complexity: AssemblyComplexity | null;
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

/** A component the surface could not feed — surfaced by the caller as a named
 * gap ("Classify the roof edges … to price Hip and ridge cap"), never silent. */
export interface AssemblySkippedComponent {
  readonly label: string;
  readonly need: "area" | "perimeter" | "edges";
}

/** The complexity-derived waste that was actually applied — shown to the user
 * ("Waste 12% (hips on this roof) — change it in the Pricebook."). */
export interface AssemblyDerivedWaste {
  readonly percent: number;
  readonly reason: string;
}

export interface AssemblyComputeResult {
  readonly lines: readonly AssemblySeedLine[];
  /** Σ round(qty × rate) over non-optional lines, minimum line included. */
  readonly totalCents: number;
  /** Set when the job minimum kicked in — the caller surfaces the notice. */
  readonly minimum: { readonly minimumCents: number; readonly addedCents: number } | null;
  /** Components skipped because the surface lacks their basis — surfaced by
   * the caller, never a silent drop. */
  readonly skipped: readonly AssemblySkippedComponent[];
  /** Set when any material priced with complexity-derived waste. */
  readonly derivedWaste: AssemblyDerivedWaste | null;
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
  bundles: "bundle",
  rolls: "roll",
  sticks: "stick",
  boots: "boot",
  squares: "square",
};
const unitLabel = (qty: number, unit: string): string =>
  qty === 1 ? (SINGULAR[unit] ?? unit) : unit;

/** Trim float noise for descriptions: 15.5 → "15.5", 16 → "16". */
const formatQty = (qty: number): string =>
  Number.isInteger(qty) ? String(qty) : String(round2(qty));

// ---- waste derivation ---------------------------------------------------------

type WasteTier = keyof WasteByComplexity;

/** The waste tier a roof's complexity lands in: simple (no hips/valleys),
 * cut-up (hips AND valleys, or either count ≥3), moderate otherwise. Counts,
 * not the lib's any-at-all cutUp flag — one hip is not a cut-up roof. */
export function wasteTierFor(complexity: AssemblyComplexity): WasteTier {
  if (complexity.hips === 0 && complexity.valleys === 0) return "simple";
  if ((complexity.hips > 0 && complexity.valleys > 0) || complexity.hips >= 3 || complexity.valleys >= 3) {
    return "cutUp";
  }
  return "moderate";
}

/** Why the derived waste applied, in the user's vocabulary. */
const wasteReason = (tier: WasteTier, complexity: AssemblyComplexity): string => {
  if (tier === "cutUp") return "cut-up roof";
  if (tier === "simple") return "simple roof";
  return complexity.hips > 0 ? "hips on this roof" : "valleys on this roof";
};

// ---- component quantities -----------------------------------------------------

interface ComputedComponent {
  readonly component: AssemblyComponent;
  readonly quantity: number;
  /** Per-unit cost in cents. */
  readonly unitCostCents: number;
  /** The parenthetical the description carries — null for plain labels. */
  readonly quantityNote: string | null;
}

type BasisResolution =
  | { readonly kind: "value"; readonly value: number }
  | { readonly kind: "missing"; readonly need: AssemblySkippedComponent["need"] }
  /** The measurement exists and says zero (no valleys / count dialed to 0) —
   * the component deliberately doesn't apply; omit without a notice. */
  | { readonly kind: "off" };

function basisValue(basis: ComponentBasis, input: AssemblyMeasureInput): BasisResolution {
  if (basis === "area") {
    return input.areaSqft > 0
      ? { kind: "value", value: input.areaSqft }
      : { kind: "missing", need: "area" };
  }
  if (basis === "perimeter") {
    return input.perimeterLnft !== null && input.perimeterLnft > 0
      ? { kind: "value", value: input.perimeterLnft }
      : { kind: "missing", need: "perimeter" };
  }
  if ("edges" in basis) {
    if (input.edges === null) return { kind: "missing", need: "edges" };
    const edges = input.edges;
    const value = basis.edges.reduce((sum, key: EdgeClassKey) => sum + edges[key], 0);
    return value > 0 ? { kind: "value", value: round2(value) } : { kind: "off" };
  }
  return basis.count > 0 ? { kind: "value", value: basis.count } : { kind: "off" };
}

const chain = (basis: number, factors: readonly number[] | undefined): number =>
  (factors ?? []).reduce((acc, factor) => acc * factor, basis);

interface ComputeContext {
  readonly config: AssemblyConfig;
  readonly input: AssemblyMeasureInput;
  readonly quantitiesByKey: ReadonlyMap<string, number>;
  /** Components that SKIPPED (missing measurement) — equipment sourcing one
   * inherits the gap; equipment sourcing an OFF component goes off silently. */
  readonly skippedNeedByKey: ReadonlyMap<string, AssemblySkippedComponent["need"]>;
  /** Records the derived waste a material actually applied. */
  readonly onDerivedWaste: (waste: AssemblyDerivedWaste) => void;
}

/** A material's effective waste multiplier — derived from complexity when the
 * component opts in and the surface is classified; the flat factor otherwise. */
function effectiveWasteFactor(
  component: Extract<AssemblyComponent, { kind: "material" }>,
  ctx: ComputeContext,
): number {
  const table = ctx.config.wasteByComplexity;
  if (component.usesDerivedWaste !== true || table === undefined || ctx.input.complexity === null) {
    return component.wasteFactor;
  }
  const tier = wasteTierFor(ctx.input.complexity);
  const factor = table[tier];
  ctx.onDerivedWaste({
    percent: round2((factor - 1) * 100),
    reason: wasteReason(tier, ctx.input.complexity),
  });
  return factor;
}

function computeComponent(
  component: AssemblyComponent,
  ctx: ComputeContext,
): ComputedComponent | AssemblySkippedComponent | "off" {
  switch (component.kind) {
    case "material": {
      const basis = basisValue(component.basis, ctx.input);
      if (basis.kind === "missing") return { label: component.label, need: basis.need };
      if (basis.kind === "off") return "off";
      const chained = chain(basis.value, component.factors);
      const wasted = chained * effectiveWasteFactor(component, ctx); // waste FIRST…
      const rounded =
        component.packSize !== null
          ? roundUpToPack(wasted, component.packSize) // …THEN pack-round
          : round2(wasted);
      const quantity = rounded + (component.extraUnits ?? 0); // …spares LAST
      return {
        component,
        quantity,
        unitCostCents: component.unitCostCents,
        quantityNote: `${formatQty(quantity)} ${unitLabel(quantity, component.unit)}`,
      };
    }
    case "labor": {
      const resolved = basisValue(component.basis, ctx.input);
      if (resolved.kind === "missing") return { label: component.label, need: resolved.need };
      if (resolved.kind === "off") return "off";
      const basis = chain(resolved.value, component.factors);
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
      let source: number;
      if ("componentKey" in component.source) {
        const fromComponent = ctx.quantitiesByKey.get(component.source.componentKey);
        if (fromComponent === undefined) {
          const need = ctx.skippedNeedByKey.get(component.source.componentKey);
          // Source skipped for a missing measurement → this gap is loud too;
          // source deliberately off (zero linears / zero count) → off with it.
          return need === undefined ? "off" : { label: component.label, need };
        }
        source = fromComponent;
      } else {
        const resolved = basisValue(component.source.basis, ctx.input);
        if (resolved.kind === "missing") return { label: component.label, need: resolved.need };
        if (resolved.kind === "off") return "off";
        source = resolved.value;
      }
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
): {
  computed: ComputedComponent[];
  skipped: AssemblySkippedComponent[];
  derivedWaste: AssemblyDerivedWaste | null;
} {
  const computed: ComputedComponent[] = [];
  const skipped: AssemblySkippedComponent[] = [];
  let derivedWaste: AssemblyDerivedWaste | null = null;
  const quantitiesByKey = new Map<string, number>();
  const skippedNeedByKey = new Map<string, AssemblySkippedComponent["need"]>();
  const ctx: ComputeContext = {
    config,
    input,
    quantitiesByKey,
    skippedNeedByKey,
    onDerivedWaste: (waste) => {
      derivedWaste = waste;
    },
  };
  // Two passes so equipment can source any component's quantity regardless of
  // declaration order (the schema already forbids equipment-on-equipment).
  const equipment: AssemblyComponent[] = [];
  for (const component of config.components) {
    if (component.kind === "equipment") {
      equipment.push(component);
      continue;
    }
    const result = computeComponent(component, ctx);
    if (result === "off") continue;
    if (!("component" in result)) {
      skipped.push(result);
      skippedNeedByKey.set(component.key, result.need);
      continue;
    }
    quantitiesByKey.set(component.key, result.quantity);
    computed.push(result);
  }
  for (const component of equipment) {
    const result = computeComponent(component, ctx);
    if (result === "off") continue;
    if (!("component" in result)) {
      skipped.push(result);
      continue;
    }
    computed.push(result);
  }
  return { computed, skipped, derivedWaste };
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

/** A line-basis assembly's sell quantity: every classed linear, summed. */
const totalEdgeFt = (edges: AssemblyEdgeTotals): number =>
  round2(EDGE_CLASS_KEYS.reduce((sum, key) => sum + edges[key], 0));

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
      : assembly.measurementBasis === "line"
        ? totalEdgeFt(input.edges ?? { eaveFt: 0, rakeFt: 0, ridgeFt: 0, hipFt: 0, valleyFt: 0 })
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

/** The up-front gates: inputs the assembly cannot price at all. */
function gate(
  assembly: AssemblyForCompute,
  input: AssemblyMeasureInput,
): ValidationError | null {
  const requiredSurface = assembly.config.surface;
  if (requiredSurface !== undefined && input.surface !== requiredSurface) {
    return validation(
      requiredSurface === "pitched"
        ? `"${assembly.name}" prices pitched roofs — ${input.sourceName} is a flat surface`
        : `"${assembly.name}" prices flat surfaces — ${input.sourceName} is pitched`,
      "surface",
    );
  }
  if (assembly.measurementBasis === "area" && input.areaSqft <= 0) {
    return validation(
      `${input.sourceName} has no measured area to price "${assembly.name}" from`,
      "areaSqft",
    );
  }
  if (
    assembly.measurementBasis === "perimeter" &&
    (input.perimeterLnft === null || input.perimeterLnft <= 0)
  ) {
    return validation(
      `${input.sourceName} has no measured perimeter to price "${assembly.name}" from`,
      "perimeterLnft",
    );
  }
  if (
    assembly.measurementBasis === "line" &&
    (input.edges === null || totalEdgeFt(input.edges) <= 0)
  ) {
    return validation(
      `${input.sourceName} has no classified roof edges to price "${assembly.name}" from — classify the edges on the trace`,
      "edges",
    );
  }
  if (assembly.measurementBasis === "count" && assembly.pricingMode === "unit_rate") {
    // Mirrored in Assembly.create — a count of units has no single sell line.
    return validation(
      `"${assembly.name}" is count-based and can't sell one unit-rate line — price it cost-plus`,
      "measurementBasis",
    );
  }
  return null;
}

/**
 * Run one assembly against one measured surface. Errors are for inputs the
 * assembly cannot price (wrong surface kind, missing basis) — the caller shows
 * the message; a zero-line success is impossible for cost-plus only when at
 * least one component computes, so an all-skipped/off recipe errs loudly.
 */
export function computeAssemblySeed(
  assembly: AssemblyForCompute,
  input: AssemblyMeasureInput,
): Result<AssemblyComputeResult, ValidationError> {
  const gateError = gate(assembly, input);
  if (gateError !== null) return err(gateError);

  const { computed, skipped, derivedWaste } = computeAllComponents(assembly.config, input);

  let lines: AssemblySeedLine[];
  if (assembly.pricingMode === "cost_plus") {
    if (computed.length === 0) {
      return err(
        validation(
          `${input.sourceName} has none of the measurements "${assembly.name}" prices from`,
          "config",
        ),
      );
    }
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

  return ok({ lines, totalCents, minimum, skipped, derivedWaste });
}
