import { describe, it, expect } from "vitest";
import { costingRows, costingTotals, type CostingItem } from "./job-costing-derive";

const item = (over: Partial<CostingItem> = {}): CostingItem => ({
  jobId: "j1",
  num: "J-1001",
  title: "Water heater install",
  customerName: "Kessler Residence",
  jobStatus: "complete",
  visits: 1,
  hours: 4,
  costCents: 10_000,
  costIsPartial: false,
  source: "measured",
  quotedCents: 50_000,
  materialsCents: 5_000,
  revenueCents: 40_000,
  callbackOf: null,
  scheduledHours: 4,
  ...over,
});

describe("costingRows — margin", () => {
  it("is revenue minus labour and materials", () => {
    const [r] = costingRows([item()]);
    expect(r?.marginCents).toBe(25_000); // 40,000 − 10,000 − 5,000
    expect(r?.marginPct).toBe(62.5);
  });

  it("is NULL when nobody who worked it has a rate", () => {
    // A margin computed from an unknown cost is not smaller, it is wrong — and wrong in the
    // direction somebody prices the next job from.
    const [r] = costingRows([item({ costCents: null })]);
    expect(r?.marginCents).toBeNull();
    expect(r?.marginPct).toBeNull();
  });

  it("is NULL when only SOME of the crew has a rate", () => {
    const [r] = costingRows([item({ costIsPartial: true })]);
    expect(r?.marginCents).toBeNull();
  });

  it("is NULL when nothing has been invoiced — not a loss", () => {
    // "Not invoiced yet" and "invoiced for nothing" are different facts.
    const [r] = costingRows([item({ revenueCents: null })]);
    expect(r?.marginCents).toBeNull();
  });

  it("never divides by zero revenue", () => {
    const [r] = costingRows([item({ revenueCents: 0 })]);
    expect(r?.marginCents).toBe(-15_000);
    expect(r?.marginPct).toBeNull(); // not Infinity
  });
});

describe("costingRows — overrun", () => {
  it("reports how far actual ran over what was booked", () => {
    const [r] = costingRows([item({ hours: 6, scheduledHours: 4 })]);
    expect(r?.overrunPct).toBe(50);
  });
  it("is negative when the job came in under", () => {
    const [r] = costingRows([item({ hours: 3, scheduledHours: 4 })]);
    expect(r?.overrunPct).toBe(-25);
  });
  it("is null with nothing booked, rather than dividing by zero", () => {
    const [r] = costingRows([item({ scheduledHours: 0 })]);
    expect(r?.overrunPct).toBeNull();
  });
});

describe("costingRows — callbacks", () => {
  const parent = item({ jobId: "j1", num: "J-1001" });
  const callback = item({
    jobId: "j2",
    num: "J-1001-C",
    callbackOf: "j1",
    revenueCents: null,
    costCents: 3_000,
    materialsCents: 1_000,
    hours: 1,
  });

  it("nests a callback under the job it came back on", () => {
    const rows = costingRows([parent, callback]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.callbacks).toHaveLength(1);
    expect(rows[0]?.callbacks[0]?.num).toBe("J-1001-C");
  });

  it("keeps a callback whose parent is NOT in the week at the top level", () => {
    // Its cost is real and belongs in the total whenever the original job ran.
    const rows = costingRows([callback]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.num).toBe("J-1001-C");
  });

  it("sorts top-level jobs by hours, heaviest first", () => {
    const rows = costingRows([item({ jobId: "a", hours: 2 }), item({ jobId: "b", hours: 9 })]);
    expect(rows.map((r) => r.jobId)).toEqual(["b", "a"]);
  });
});

describe("costingTotals", () => {
  it("sums money across jobs and their callbacks", () => {
    const rows = costingRows([
      item({ jobId: "j1" }),
      item({ jobId: "j2", callbackOf: "j1", revenueCents: null, costCents: 3_000, materialsCents: 1_000 }),
    ]);
    const t = costingTotals(rows, 10);
    expect(t.revenueCents).toBe(40_000);
    expect(t.laborCents).toBe(13_000);
    expect(t.materialsCents).toBe(6_000);
    expect(t.marginCents).toBe(21_000);
  });

  it("counts the callback in the MONEY but not in the job count", () => {
    const rows = costingRows([item({ jobId: "j1" }), item({ jobId: "j2", callbackOf: "j1" })]);
    expect(costingTotals(rows, 10).jobs).toBe(1);
  });

  it("goes null the moment ANY job in the week cannot be costed", () => {
    // The jobs left out are exactly the ones whose cost we could not see, so a partial sum can
    // only be too high — the flattering direction again.
    const rows = costingRows([item({ jobId: "j1" }), item({ jobId: "j2", costCents: null })]);
    const t = costingTotals(rows, 10);
    expect(t.laborCents).toBeNull();
    expect(t.directCostCents).toBeNull();
    expect(t.marginCents).toBeNull();
    expect(t.marginPct).toBeNull();
    expect(t.uncostedJobs).toBe(1);
  });

  it("reports utilization against paid hours", () => {
    const rows = costingRows([item({ hours: 6 })]);
    expect(costingTotals(rows, 10).utilizationPct).toBe(60);
  });

  it("has NO utilization when nothing was paid — 0% would read as idle", () => {
    expect(costingTotals(costingRows([item()]), 0).utilizationPct).toBeNull();
  });

  it("survives an empty week", () => {
    const t = costingTotals([], 0);
    expect(t.jobs).toBe(0);
    expect(t.marginCents).toBe(0); // nothing unknown, nothing earned
    expect(t.utilizationPct).toBeNull();
  });
});

describe("costingTotals — when the two hour records disagree", () => {
  it("withholds utilization when job hours EXCEED paid hours", () => {
    // Real condition: a technician taps Arrived and Done on the job but never clocks in for the
    // day. Job hours then outrun paid hours and the ratio prints something like 1,718%.
    const rows = costingRows([item({ hours: 33 })]);
    const t = costingTotals(rows, 1.92);
    expect(t.utilizationPct).toBeNull();
    expect(t.hoursExceedPaid).toBe(true);
  });

  it("reports normally when job hours sit inside paid hours", () => {
    const t = costingTotals(costingRows([item({ hours: 6 })]), 10);
    expect(t.utilizationPct).toBe(60);
    expect(t.hoursExceedPaid).toBe(false);
  });

  it("is not 'exceeding' when nothing was paid at all — that is the other null", () => {
    const t = costingTotals(costingRows([item({ hours: 6 })]), 0);
    expect(t.utilizationPct).toBeNull();
    expect(t.hoursExceedPaid).toBe(false);
  });
});
