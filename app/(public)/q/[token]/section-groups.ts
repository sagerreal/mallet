/**
 * The customer's copy, grouped under the headings the shop wrote on the quote.
 *
 * Pure and separate from the page so the grouping can be tested without rendering a server
 * component — the same reason tier-view.ts sits beside it.
 */

import type { Estimate } from "@/modules/quoting/domain/estimate";

type Lines = ReturnType<Estimate["linesForTier"]>;
type Line = Lines[number];

export interface SectionGroup {
  readonly name: string;
  readonly lines: readonly Line[];
  /** What the work under this heading comes to, in cents. */
  readonly totalCents: number;
}

export interface GroupedLines {
  /** The work that sits above the first heading. On an ungrouped quote this is every line. */
  readonly ungrouped: readonly Line[];
  readonly groups: readonly SectionGroup[];
}

/**
 * Split the lines into what sits above the first heading and what sits under each one.
 *
 * A heading with nothing under it does not appear — an empty band explains nothing to the
 * person reading the quote. A line whose heading is missing falls back to ungrouped rather
 * than disappearing: the customer must see everything they are being charged for, even if the
 * grouping is broken.
 */
export function groupBySection(estimate: Estimate, lines: readonly Line[]): GroupedLines {
  const groups: SectionGroup[] = [];
  const claimed = new Set<string>();
  for (const section of estimate.sections) {
    const under = lines.filter((line) => line.props.sectionId === section.props.id);
    if (under.length === 0) continue;
    for (const line of under) claimed.add(line.props.id);
    groups.push({
      name: section.props.name,
      lines: under,
      totalCents: under.reduce((sum, line) => sum + line.amount(), 0),
    });
  }
  return { ungrouped: lines.filter((line) => !claimed.has(line.props.id)), groups };
}
