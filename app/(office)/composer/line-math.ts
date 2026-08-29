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

/**
 * The lines to send, with every `parentIndex` re-pointed at the position its parent actually
 * lands in.
 *
 * Two things reindex the array on the way to the wire — blank scaffolding rows are dropped, and
 * a tiered quote concatenates three tier arrays into one — and an index that was correct before
 * either is silently wrong after. It names a DIFFERENT line, so a component's money attaches to
 * someone else's assembly, or to a line that is no longer there.
 *
 * A component whose parent did not survive the filter is dropped with it: a part with no
 * assembly around it is not a line the customer should be charged for.
 */
export function reindexForPayload<T extends ComposerLine>(
  lines: readonly T[],
  keep: (line: T) => boolean,
): T[] {
  // A component is kept only if it survives on its own merits AND its parent did.
  const survives = lines.map((line, i) => {
    if (!keep(line)) return false;
    if (line.parentIndex == null) return true;
    const parent = lines[line.parentIndex];
    return parent !== undefined && keep(parent) && parent.parentIndex == null;
  });
  const at = new Map<number, number>();
  let next = 0;
  survives.forEach((kept, i) => {
    if (kept) at.set(i, next++);
  });
  return lines
    .filter((_line, i) => survives[i])
    .map((line) =>
      line.parentIndex == null ? line : { ...line, parentIndex: at.get(line.parentIndex)! },
    );
}

/** What the lines under one section add up to — components excluded, they are inside a parent. */
export function sectionTotal(lines: readonly ComposerLine[], sectionIndex: number): number {
  const cents = lines.reduce((sum, line) => {
    if (line.sectionIndex !== sectionIndex || line.parentIndex != null) return sum;
    return sum + toCents((line.q ?? 0) * (line.r ?? 0));
  }, 0);
  return fromCents(cents);
}

/**
 * Remove a section, keeping every line and every remaining `sectionIndex` pointed where it was.
 *
 * The lines survive — they become ungrouped. Deleting a heading is not a request to delete the
 * work under it, and there is no undo here.
 */
export function removeSectionAt(
  sections: readonly string[],
  lines: readonly ComposerLine[],
  index: number,
): { sections: string[]; lines: ComposerLine[] } {
  return {
    sections: sections.filter((_name, i) => i !== index),
    lines: lines.map((line) => {
      if (line.sectionIndex == null) return line;
      if (line.sectionIndex === index) {
        const { sectionIndex: _dropped, ...rest } = line;
        return rest;
      }
      return line.sectionIndex > index
        ? { ...line, sectionIndex: line.sectionIndex - 1 }
        : line;
    }),
  };
}

/**
 * Sections and lines as they should go on the wire: headings whose name was cleared are dropped,
 * and the lines under them become ungrouped rather than pointing at a heading that is not sent.
 *
 * The server refuses a blank heading (min(1)), so without this an emptied name fails the whole
 * draft — and the estimator would see "the server refused these details" for a name they simply
 * cleared.
 */
export function sectionsForPayload(
  sections: readonly string[],
  lines: readonly ComposerLine[],
): { sections: string[]; lines: ComposerLine[] } {
  const at = new Map<number, number>();
  const kept: string[] = [];
  sections.forEach((name, i) => {
    if (name.trim() === "") return;
    at.set(i, kept.length);
    kept.push(name.trim());
  });
  return {
    sections: kept,
    lines: lines.map((line) => {
      if (line.sectionIndex == null) return line;
      const moved = at.get(line.sectionIndex);
      if (moved === undefined) {
        const { sectionIndex: _dropped, ...rest } = line;
        return rest;
      }
      return moved === line.sectionIndex ? line : { ...line, sectionIndex: moved };
    }),
  };
}

const BPS = 10_000;

/**
 * Is this line priced FROM its cost — cost × (1 + markup) — rather than from a typed price?
 *
 * There is no separate "price source" column, and there does not need to be: carrying a markup
 * IS the statement that the price came from the cost. A typed price clears it, which is the
 * estimator saying the number is theirs now.
 */
export function isPricedFromCost(line: ComposerLine): boolean {
  return line.markupBps != null;
}

/** The markup a line's price implies over its cost, in basis points. 0 when there is no cost. */
export function impliedMarkupBps(line: ComposerLine): number {
  const cost = line.c ?? 0;
  if (cost <= 0) return 0;
  return Math.round(((line.r ?? 0) / cost - 1) * BPS);
}

/** Price this line from its cost. The markup is kept, so changing the cost reprices it. */
export function withMarkup(line: ComposerLine, markupBps: number): ComposerLine {
  const bps = Math.max(0, Math.round(markupBps));
  const cost = line.c ?? 0;
  return { ...line, markupBps: bps, r: Math.round(cost * (1 + bps / BPS) * 100) / 100 };
}

/** Re-apply an existing markup after the cost moved. A line priced by hand is left alone. */
export function repriceFromCost(line: ComposerLine): ComposerLine {
  return isPricedFromCost(line) ? withMarkup(line, line.markupBps!) : line;
}

/** A typed price. Drops the markup — the number is the estimator's now, not the cost's. */
export function withTypedRate(line: ComposerLine, rate: number): ComposerLine {
  const { markupBps: _dropped, ...rest } = line;
  return { ...rest, r: rate };
}

/** A saved assembly's part, as the pricebook hands it over (dollars, like every store amount). */
export interface SavedComponent {
  readonly d: string;
  readonly unit?: string;
  readonly qtyExpr?: string;
  readonly roundUp?: boolean;
  readonly cost: number;
  readonly rate: number;
  readonly markupBps?: number;
}

/**
 * A saved assembly dropped onto the quote: the parent line, then its parts beneath it.
 *
 * A copy, not a translation — the stored fields and the line's fields are the same fields, so
 * what the office saved is exactly what lands. The driver defaults to 1 and the office types
 * the real run; every part recounts off it the moment they do.
 */
export function linesFromSavedAssembly(
  lines: readonly ComposerLine[],
  saved: {
    readonly id: string;
    readonly name: string;
    readonly unit?: string | null;
    readonly unitPrice: number;
    readonly cost: number;
    readonly taxable: boolean;
    readonly components: readonly SavedComponent[];
  },
): ComposerLine[] {
  const at = lines.length;
  const parent: ComposerLine = {
    d: saved.name,
    q: 1,
    r: saved.unitPrice,
    ...(saved.cost > 0 ? { c: saved.cost } : {}),
    ...(saved.unit ? { unit: saved.unit } : {}),
    ...(saved.taxable ? {} : { notax: true as const }),
    // The link that makes "Update in pricebook" possible later.
    pricebookItemId: saved.id,
  };
  const components: ComposerLine[] = saved.components.map((c) => ({
    d: c.d,
    // The stored quantity is whatever the expression resolves to against a driver of 1; the
    // office's first edit to the driver replaces it. Storing 0 here would read as free.
    q: resolveQuantity({ d: c.d, q: 1, r: c.rate, qtyExpr: c.qtyExpr, roundUp: c.roundUp }, parent).value,
    r: c.rate,
    ...(c.cost > 0 ? { c: c.cost } : {}),
    ...(c.unit ? { unit: c.unit } : {}),
    ...(c.qtyExpr ? { qtyExpr: c.qtyExpr } : {}),
    ...(c.roundUp ? { roundUp: true } : {}),
    ...(c.markupBps === undefined ? {} : { markupBps: c.markupBps }),
    parentIndex: at,
  }));
  return withRollUps([...lines, parent, ...components]);
}

/**
 * Is this assembly in the pricebook, the same as what is there, or drifted from it?
 *
 * The three states the office acts on: save it, leave it alone, or update it. Comparing the
 * PARTS and not the parent's own price is deliberate — an assembly whose rate was rounded on
 * the way into the quote has not "drifted", and telling the office it had would train them to
 * ignore the word.
 */
export type AssemblySyncState = "unsaved" | "synced" | "modified";

export function assemblySyncState(
  parent: ComposerLine,
  components: readonly ComposerLine[],
  saved: readonly SavedComponent[] | undefined,
): AssemblySyncState {
  if (!parent.pricebookItemId || saved === undefined) return "unsaved";
  return liveSignature(components) === savedSignature(saved) ? "synced" : "modified";
}

/** The live parts, in the same shape the saved ones are compared in. */
function liveSignature(components: readonly ComposerLine[]): string {
  return JSON.stringify(
    components.map((c) => [
      c.d,
      c.unit ?? "",
      c.qtyExpr ?? "",
      Boolean(c.roundUp),
      Math.round((c.c ?? 0) * 100),
      Math.round((c.r ?? 0) * 100),
      c.markupBps ?? null,
    ]),
  );
}

function savedSignature(components: readonly SavedComponent[]): string {
  return JSON.stringify(
    components.map((c) => [
      c.d,
      c.unit ?? "",
      c.qtyExpr ?? "",
      Boolean(c.roundUp),
      Math.round(c.cost * 100),
      Math.round(c.rate * 100),
      c.markupBps ?? null,
    ]),
  );
}
