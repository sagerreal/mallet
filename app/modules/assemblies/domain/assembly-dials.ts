import type { AssemblyComponent, AssemblyConfig, EdgeClassKey, WasteByComplexity } from "./assembly-config";
import { EDGE_CLASS_KEYS } from "./assembly-config";

/**
 * Dials — the org-tunable constants of an assembly, addressed structurally so
 * ONE generic editor (the pricebook Assemblies card) can surface "Hot-mix
 * price — $120/ton" without knowing what asphalt is. A dial's target points
 * into the assembly (top-level margin/minimum, a component field, a conversion
 * factor, a rate bracket); get/set here are the only code that walks a config
 * blob, and set is strictly immutable — a new config every time.
 *
 * RAW values flow through get/set (cents, bps, bare factors); the dial's
 * `format` tells the editor how to render/parse for display:
 *  - dollars:      cents ⇄ dollars input
 *  - percentBps:   bps ⇄ percent input
 *  - wastePercent: multiplier (1.07) ⇄ percent input (7)
 *  - number:       raw number, with unitSuffix ("in", "sq ft")
 *  - toggle:       0/1 ⇄ a checkbox (the ice-dam-region switch)
 */

export type DialFormat = "dollars" | "percentBps" | "wastePercent" | "number" | "toggle";

export type DialTarget =
  | { readonly kind: "marginBps" }
  | { readonly kind: "jobMinimumCents" }
  | {
      readonly kind: "componentField";
      readonly componentKey: string;
      readonly field:
        | "unitCostCents"
        | "rateCents"
        | "amountCents"
        | "wasteFactor"
        | "packSize"
        | "unitsPerDay"
        | "unitsPerHour"
        | "perQuantity";
    }
  | { readonly kind: "componentFactor"; readonly componentKey: string; readonly index: number }
  | { readonly kind: "tierRate"; readonly index: number }
  /** One tier of the config's derived-waste table (wastePercent format). */
  | { readonly kind: "configWasteTier"; readonly tier: keyof WasteByComplexity }
  /** A COUNT component's dialed quantity ({count:n} basis; number format). */
  | { readonly kind: "componentCount"; readonly componentKey: string }
  /** Whether an edges-sum component includes one class (toggle format) — the
   * ice-dam switch adds/removes the eave courses from ice & water shield. */
  | { readonly kind: "componentEdgeToggle"; readonly componentKey: string; readonly edge: EdgeClassKey };

export interface AssemblyDial {
  readonly key: string;
  readonly label: string;
  readonly format: DialFormat;
  /** Trade-vocabulary unit shown after the value ("per ton", "in"). */
  readonly unitSuffix?: string;
  readonly target: DialTarget;
}

/** The slice of an assembly a dial can read/write. */
export interface DialableAssembly {
  readonly marginBps: number;
  readonly jobMinimumCents: number;
  readonly config: AssemblyConfig;
}

function componentByKey(config: AssemblyConfig, key: string): AssemblyComponent | null {
  return config.components.find((component) => component.key === key) ?? null;
}

function readComponentField(
  component: AssemblyComponent,
  field: Extract<DialTarget, { kind: "componentField" }>["field"],
): number | null {
  const value = (component as Record<string, unknown>)[field];
  return typeof value === "number" ? value : null;
}

/** The dial's raw value, or null when the target doesn't resolve (stale dial vs
 * an edited config) — the editor hides unresolvable dials instead of guessing. */
export function getDialValue(assembly: DialableAssembly, target: DialTarget): number | null {
  switch (target.kind) {
    case "marginBps":
      return assembly.marginBps;
    case "jobMinimumCents":
      return assembly.jobMinimumCents;
    case "componentField": {
      const component = componentByKey(assembly.config, target.componentKey);
      return component === null ? null : readComponentField(component, target.field);
    }
    case "componentFactor": {
      const component = componentByKey(assembly.config, target.componentKey);
      if (component === null || component.kind !== "material") return null;
      return component.factors[target.index] ?? null;
    }
    case "tierRate":
      return assembly.config.tiers?.[target.index]?.rateCents ?? null;
    case "configWasteTier":
      return assembly.config.wasteByComplexity?.[target.tier] ?? null;
    case "componentCount": {
      const component = componentByKey(assembly.config, target.componentKey);
      if (component === null || component.kind === "fixed" || component.kind === "equipment") return null;
      return typeof component.basis === "object" && "count" in component.basis
        ? component.basis.count
        : null;
    }
    case "componentEdgeToggle": {
      const component = componentByKey(assembly.config, target.componentKey);
      if (component === null || component.kind === "fixed" || component.kind === "equipment") return null;
      if (typeof component.basis !== "object" || !("edges" in component.basis)) return null;
      return component.basis.edges.includes(target.edge) ? 1 : 0;
    }
  }
}

const setComponent = (
  config: AssemblyConfig,
  key: string,
  patch: (component: AssemblyComponent) => AssemblyComponent,
): AssemblyConfig => ({
  ...config,
  components: config.components.map((component) =>
    component.key === key ? patch(component) : component,
  ),
});

/**
 * Write a raw value through a dial — a NEW assembly slice every time; the
 * original is never touched. Returns null when the target doesn't resolve
 * (never a silent no-op write).
 */
export function setDialValue(
  assembly: DialableAssembly,
  target: DialTarget,
  raw: number,
): DialableAssembly | null {
  switch (target.kind) {
    case "marginBps":
      return { ...assembly, marginBps: raw };
    case "jobMinimumCents":
      return { ...assembly, jobMinimumCents: raw };
    case "componentField": {
      if (getDialValue(assembly, target) === null) return null;
      return {
        ...assembly,
        config: setComponent(assembly.config, target.componentKey, (component) => ({
          ...component,
          [target.field]: raw,
        })),
      };
    }
    case "componentFactor": {
      if (getDialValue(assembly, target) === null) return null;
      return {
        ...assembly,
        config: setComponent(assembly.config, target.componentKey, (component) =>
          component.kind === "material"
            ? {
                ...component,
                factors: component.factors.map((factor, i) => (i === target.index ? raw : factor)),
              }
            : component,
        ),
      };
    }
    case "tierRate": {
      const tiers = assembly.config.tiers;
      if (tiers === null || tiers[target.index] === undefined) return null;
      return {
        ...assembly,
        config: {
          ...assembly.config,
          tiers: tiers.map((tier, i) => (i === target.index ? { ...tier, rateCents: raw } : tier)),
        },
      };
    }
    case "configWasteTier": {
      const table = assembly.config.wasteByComplexity;
      if (table === undefined) return null;
      return {
        ...assembly,
        config: { ...assembly.config, wasteByComplexity: { ...table, [target.tier]: raw } },
      };
    }
    case "componentCount": {
      if (getDialValue(assembly, target) === null) return null;
      return {
        ...assembly,
        config: setComponent(assembly.config, target.componentKey, (component) => ({
          ...component,
          basis: { count: Math.max(0, Math.round(raw)) },
        })),
      };
    }
    case "componentEdgeToggle": {
      if (getDialValue(assembly, target) === null) return null;
      let refused = false;
      const config = setComponent(assembly.config, target.componentKey, (component) => {
        if (component.kind === "fixed" || component.kind === "equipment") return component;
        const basis = component.basis;
        if (typeof basis !== "object" || !("edges" in basis)) return component;
        const on = raw !== 0;
        if (on) {
          if (basis.edges.includes(target.edge)) return component;
          // Insert in canonical class order so equal configs stay byte-equal.
          const edges = EDGE_CLASS_KEYS.filter(
            (key) => key === target.edge || basis.edges.includes(key),
          );
          return { ...component, basis: { edges } };
        }
        const edges = basis.edges.filter((key) => key !== target.edge);
        if (edges.length === 0) {
          refused = true; // an edges component must keep ≥1 class — never a silent no-op
          return component;
        }
        return { ...component, basis: { edges } };
      });
      return refused ? null : { ...assembly, config };
    }
  }
}

/** Display value for a dial (dollars/percent/number/toggle) from its raw value. */
export function dialDisplayValue(format: DialFormat, raw: number): number {
  switch (format) {
    case "dollars":
      return raw / 100;
    case "percentBps":
      return raw / 100;
    case "wastePercent":
      return Math.round((raw - 1) * 1000) / 10;
    case "number":
      return raw;
    case "toggle":
      return raw === 0 ? 0 : 1;
  }
}

/** Raw value from a display input; null for an unparseable/negative entry. */
export function dialRawValue(format: DialFormat, display: number): number | null {
  if (!Number.isFinite(display) || display < 0) return null;
  switch (format) {
    case "dollars":
      return Math.round(display * 100);
    case "percentBps":
      return Math.round(display * 100);
    case "wastePercent":
      return 1 + display / 100;
    case "number":
      return display;
    case "toggle":
      return display === 0 ? 0 : 1;
  }
}
