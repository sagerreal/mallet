/**
 * Assemblies in the composer: a line whose price is the roll-up of the component lines under
 * it, each counted off the parent's quantity.
 *
 * A fence is one line the customer reads — "Cedar privacy fence, 100 LF, $8,420" — and four
 * lines the estimator works in: posts, rails, pickets, labour. Change the run to 150 and every
 * component recounts. That is the whole idea, and it is why the parent's quantity is called the
 * DRIVER: the components are expressions of it ("qty/8+1" posts).
 *
 * Money stays in dollars here, like every other composer number; cents conversion happens once,
 * in lineToPayload. The quantity math itself is NOT reimplemented — it is the same evaluator the
 * server re-runs on write (modules/quoting/domain/quantity-expression), so a count the estimator
 * sees on a keystroke is the count that gets stored, the way quote-totals.ts is shared with the
 * public quote page.
 */

import { resolveLineQuantity } from "@/modules/quoting/domain/quantity-expression";
import type { ComposerLine } from "./composer-state";

/** Dollars, rounded to the cent — the composer's numbers are money, not floats. */
const toCents = (dollars: number): number => Math.round(dollars * 100);
const fromCents = (cents: number): number => cents / 100;

export interface ResolvedQuantity {
  /** The count to use. 0 when the math does not resolve — never NaN in a rendered cell. */
  readonly value: number;
  /** False when the expression is unparseable. The editor says so; nothing prices off it. */
  readonly valid: boolean;
}

/**
 * A line's quantity, resolving typed math against its parent's. A line with no expression
 * resolves to the number that is already on it, which is every ordinary line.
 */
export function resolveQuantity(line: ComposerLine, parent?: ComposerLine): ResolvedQuantity {
  const resolved = resolveLineQuantity({
    quantity: line.q ?? 0,
    qtyExpr: line.qtyExpr ?? null,
    driver: parent ? (parent.q ?? 0) : null,
    roundUp: line.roundUp ?? false,
    unitAlias: parent?.unit ?? null,
  });
  return resolved.ok ? { value: resolved.value, valid: true } : { value: 0, valid: false };
}

/** True when the text is just a number — no math to explain, no result note to show. */
export function isPlainQuantity(expression: string | undefined): boolean {
  return /^[\d,]+(?:\.\d*)?$/.test((expression ?? "").trim());
}

/** The indexes of the lines that are components of the line at `parentIndex`. */
export function componentIndexes(lines: readonly ComposerLine[], parentIndex: number): number[] {
  return lines.reduce<number[]>((found, line, i) => {
    if (line.parentIndex === parentIndex) found.push(i);
    return found;
  }, []);
}

/** True when this line has components — i.e. it is an assembly, not a plain line. */
export function isAssembly(lines: readonly ComposerLine[], index: number): boolean {
  return lines.some((line) => line.parentIndex === index);
}

/** True when this line IS a component of another. Components never price on their own. */
export function isComponent(line: ComposerLine): boolean {
  return line.parentIndex != null;
}

export interface AssemblyRollUp {
  /** The parent's rate — the components' total ÷ the driver, to the cent. */
  readonly rate: number;
  /** The parent's unit cost, derived the same way. Undefined when no component carries a cost. */
  readonly cost: number | undefined;
  /** What the components add up to. The number the rate came FROM, not the number quoted. */
  readonly componentsTotal: number;
  /** What the components cost in total. */
  readonly componentsCost: number;
}

/**
 * Roll the components up into the parent.
 *
 * The parent's RATE is the components' total divided by the driver quantity, not the total
 * itself: every surface downstream — the DTO, the invoice, the customer's copy — computes
 * `quantity × rate` and none of them knows components exist. Dividing here is what keeps that
 * true without a single change to any of them.
 *
 * A rate is whole cents, so the division does not always come out even: 14 posts at $24.30 is
 * $340.20 across a 100 LF run, which is $3.402 per foot, and the quote says $3.40 — $340.00.
 * That is not drift to be corrected. You cannot quote a customer $3.402 a foot; the components
 * are how the estimator FOUND the rate, and the rate is what is sold. The costing view shows
 * both numbers, so the few cents are visible rather than silently absorbed.
 */
export function rollUp(parent: ComposerLine, components: readonly ComposerLine[]): AssemblyRollUp {
  let sellCents = 0;
  let costCents = 0;
  let anyCost = false;
  for (const component of components) {
    const quantity = resolveQuantity(component, parent).value;
    sellCents += toCents(quantity * (component.r ?? 0));
    if (component.c != null) {
      anyCost = true;
      costCents += toCents(quantity * component.c);
    }
  }
  const driver = parent.q ?? 0;
  // A driver of zero prices nothing rather than dividing by it. The estimator is mid-typing.
  const rate = driver > 0 ? fromCents(Math.round(sellCents / driver)) : 0;
  const cost = anyCost && driver > 0 ? fromCents(Math.round(costCents / driver)) : undefined;
  return {
    rate,
    cost,
    componentsTotal: fromCents(sellCents),
    componentsCost: fromCents(costCents),
  };
}

/**
 * Every line with its components rolled into it — the one function the editor calls after any
 * edit. Ordinary lines pass through untouched, so this is safe to run over the whole quote.
 */
export function withRollUps(lines: readonly ComposerLine[]): ComposerLine[] {
  return lines.map((line, i) => {
    const components = componentIndexes(lines, i).map((at) => lines[at]!);
    if (components.length === 0) return line;
    const rolled = rollUp(line, components);
    // Only rewrite when the number actually moved: an untouched object keeps React's identity
    // checks meaningful and keeps an unrelated edit from re-rendering every row.
    if (line.r === rolled.rate && line.c === rolled.cost) return line;
    return rolled.cost === undefined
      ? { ...line, r: rolled.rate, c: undefined }
      : { ...line, r: rolled.rate, c: rolled.cost };
  });
}

/**
 * Remove a line and everything that hangs off it, keeping every remaining `parentIndex` pointed
 * at the same line it was before.
 *
 * Indexes are positional, so a plain `splice` silently re-parents every component above the
 * hole — the exact defect the depth-panel index remapping in line-table.tsx exists to prevent,
 * except here it would move MONEY into the wrong assembly.
 */
export function removeLineAt(lines: readonly ComposerLine[], index: number): ComposerLine[] {
  const doomed = new Set<number>([index, ...componentIndexes(lines, index)]);
  const shift = (at: number): number => at - [...doomed].filter((d) => d < at).length;
  return lines
    .filter((_line, i) => !doomed.has(i))
    .map((line) =>
      line.parentIndex == null ? line : { ...line, parentIndex: shift(line.parentIndex) },
    );
}

/**
 * Insert a new component directly beneath its parent's existing components, so the editor reads
 * top-down and the payload keeps its "a component follows its parent" rule.
 */
export function addComponent(
  lines: readonly ComposerLine[],
  parentIndex: number,
  component: ComposerLine,
): ComposerLine[] {
  const existing = componentIndexes(lines, parentIndex);
  const at = (existing[existing.length - 1] ?? parentIndex) + 1;
  const shift = (i: number): number => (i >= at ? i + 1 : i);
  const shifted = lines.map((line) =>
    line.parentIndex == null || line.parentIndex < at
      ? line
      : { ...line, parentIndex: shift(line.parentIndex) },
  );
  return [
    ...shifted.slice(0, at),
    { ...component, parentIndex },
    ...shifted.slice(at),
  ];
}
