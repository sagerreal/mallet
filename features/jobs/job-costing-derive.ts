/**
 * features/jobs/job-costing-derive.ts
 * Turning a week of costed jobs into the figures the report prints.
 *
 * ONE RULE RUNS THROUGH ALL OF IT: a margin computed from an incomplete cost is not a smaller
 * number, it is a WRONG one, and it is wrong in the flattering direction — the direction somebody
 * prices the next job from. So margin is `null` wherever any part of the cost is unknown, and the
 * screen says which part is missing instead of printing a figure that reads like good news.
 *
 * Labour can be unknown (nobody who worked it has a rate). Materials cannot: a job with no priced
 * lines genuinely cost nothing in parts, so 0 is an answer there and never a stand-in.
 */

export interface CostingItem {
  readonly jobId: string;
  readonly num: string;
  readonly title: string | null;
  readonly customerName: string;
  readonly jobStatus: string;
  readonly visits: number;
  readonly hours: number;
  readonly costCents: number | null;
  readonly costIsPartial: boolean;
  readonly source: "measured" | "scheduled" | "mixed";
  readonly quotedCents: number;
  readonly materialsCents: number;
  /**
   * What was actually BOUGHT via a placed purchase order, cents. Reported beside `materialsCents`,
   * never folded into it — a PO buys the same physical part a job line was quoted for, and summing
   * the two would report roughly double the material cost and invent a loss that never happened.
   */
  readonly purchasedCents: number;
  readonly revenueCents: number | null;
  readonly callbackOf: string | null;
  readonly scheduledHours: number;
}

export interface CostingRow extends CostingItem {
  /** revenue − (labour + materials). Null when labour is unknown or only partly known. */
  readonly marginCents: number | null;
  /** Margin as a share of revenue. Null when margin is null OR nothing was billed. */
  readonly marginPct: number | null;
  /** How far actual hours ran over what was booked, as a percentage. Null with nothing booked. */
  readonly overrunPct: number | null;
  /** Warranty callbacks that came back on this job. */
  readonly callbacks: readonly CostingRow[];
}

/** True when this row's cost cannot be trusted to be complete. */
const costUnknown = (i: CostingItem): boolean => i.costCents === null || i.costIsPartial;

function toRow(i: CostingItem, callbacks: CostingRow[]): CostingRow {
  const marginCents =
    costUnknown(i) || i.revenueCents === null ? null : i.revenueCents - (i.costCents ?? 0) - i.materialsCents;
  return {
    ...i,
    marginCents,
    // Guarded against a zero denominator: a warranty callback bills nothing, and dividing by it
    // would print Infinity% on the row whose whole point is that it earned nothing.
    marginPct:
      marginCents === null || i.revenueCents === null || i.revenueCents === 0
        ? null
        : Math.round((marginCents / i.revenueCents) * 1000) / 10,
    overrunPct:
      i.scheduledHours > 0 ? Math.round(((i.hours - i.scheduledHours) / i.scheduledHours) * 100) : null,
    callbacks,
  };
}

/**
 * Jobs with their warranty callbacks nested underneath.
 *
 * A callback has cost and no revenue, so on its own row it reads as a total loss and tells you
 * nothing. Under the job it came back on, it is the thing that quietly ate that job's margin —
 * which is the single most useful fact this report can surface.
 *
 * A callback whose parent is NOT in the week stays at the top level rather than vanishing. Its cost
 * is real and belongs in the total regardless of when the original job ran.
 */
export function costingRows(items: readonly CostingItem[]): CostingRow[] {
  const present = new Set(items.map((i) => i.jobId));
  const childrenOf = new Map<string, CostingItem[]>();
  const top: CostingItem[] = [];
  for (const i of items) {
    if (i.callbackOf !== null && present.has(i.callbackOf)) {
      childrenOf.set(i.callbackOf, [...(childrenOf.get(i.callbackOf) ?? []), i]);
    } else {
      top.push(i);
    }
  }
  return top
    .map((i) => toRow(i, (childrenOf.get(i.jobId) ?? []).map((c) => toRow(c, []))))
    .sort((a, b) => b.hours - a.hours);
}

export interface CostingTotals {
  readonly jobs: number;
  readonly visits: number;
  readonly hours: number;
  readonly revenueCents: number;
  readonly laborCents: number | null;
  readonly materialsCents: number;
  /**
   * What was actually bought via placed purchase orders, cents — summed beside `materialsCents`,
   * NEVER folded into it or into `directCostCents`/`marginCents`. Quoted and purchased answer two
   * different questions and adding them together invents a loss that never happened.
   */
  readonly purchasedCents: number;
  readonly directCostCents: number | null;
  readonly marginCents: number | null;
  readonly marginPct: number | null;
  /**
   * Job hours as a share of paid hours. Null when the figure would not mean anything.
   *
   * Two cases, and both really happen: nothing was paid (0% reads as idle, which is a claim), and
   * job hours EXCEED paid hours — a technician who tapped Arrived but never clocked in. The screen
   * says the two disagree rather than printing 1,718%.
   */
  readonly utilizationPct: number | null;
  /** True when attributed job hours exceed paid hours — the two records disagree. */
  readonly hoursExceedPaid: boolean;
  /** How many jobs could not be fully costed. The report says so rather than quietly excluding them. */
  readonly uncostedJobs: number;
}

/**
 * The week's totals.
 *
 * Labour — and therefore direct cost and margin — go null the moment ANY job in the week is missing
 * a rate. Summing the ones we can price and calling it the week's margin is precisely the flattering
 * error: the jobs left out are the ones whose cost we could not see, so the total can only be too
 * high. `uncostedJobs` is how the screen explains itself.
 *
 * Callbacks are counted in the money and NOT in the job count: a warranty return is not a job the
 * shop sold, but its cost is absolutely real.
 */
export function costingTotals(rows: readonly CostingRow[], paidHours: number): CostingTotals {
  const flat = rows.flatMap((r) => [r, ...r.callbacks]);
  const anyUnknown = flat.some(costUnknown);
  const laborCents = anyUnknown ? null : flat.reduce((s, r) => s + (r.costCents ?? 0), 0);
  const materialsCents = flat.reduce((s, r) => s + r.materialsCents, 0);
  // Never added into laborCents/materialsCents/directCostCents/marginCents — see the field doc.
  const purchasedCents = flat.reduce((s, r) => s + r.purchasedCents, 0);
  const revenueCents = flat.reduce((s, r) => s + (r.revenueCents ?? 0), 0);
  const directCostCents = laborCents === null ? null : laborCents + materialsCents;
  const marginCents = directCostCents === null ? null : revenueCents - directCostCents;
  const hours = flat.reduce((s, r) => s + r.hours, 0);
  return {
    jobs: rows.length,
    visits: flat.reduce((s, r) => s + r.visits, 0),
    hours: Math.round(hours * 100) / 100,
    revenueCents,
    laborCents,
    materialsCents,
    purchasedCents,
    directCostCents,
    marginCents,
    marginPct:
      marginCents === null || revenueCents === 0 ? null : Math.round((marginCents / revenueCents) * 1000) / 10,
    utilizationPct: paidHours > 0 && hours <= paidHours ? Math.round((hours / paidHours) * 1000) / 10 : null,
    hoursExceedPaid: paidHours > 0 && hours > paidHours,
    uncostedJobs: flat.filter(costUnknown).length,
  };
}
