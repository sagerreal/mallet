import type { AssemblyComponent, AssemblyConfig } from "./assembly-config";

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
 */

export type DialFormat = "dollars" | "percentBps" | "wastePercent" | "number";

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
  | { readonly kind: "tierRate"; readonly index: number };

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
  }
}

/** Display value for a dial (dollars/percent/number) from its raw value. */
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
  }
}
