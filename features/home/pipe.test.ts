import { describe, it, expect } from "vitest";
import { dPlus } from "@/lib/prototype-sample";
import type { Estimate, Invoice, Job, Lead, Tech } from "@/lib/store/types";
import { mkJob, mkVisit, mkInvoice, mkLead, mkTech } from "@/features/jobs/test-factories";
import { deriveHomePipe, type PipeInput } from "./pipe";

const base: PipeInput = { leads: [], estimates: [], invoices: [], jobs: [], techs: [] };
const stage = (out: ReturnType<typeof deriveHomePipe>, key: string) => out.find((s) => s.key === key)!;

const mkEstimate = (o: Partial<Estimate> = {}): Estimate => ({
  id: "est-1",
  num: "Q-1",
  leadId: "1",
  title: "Quote",
  status: "sent",
  age: 1,
  viewed: false,
  fu: { on: false, stage: 0 },
  lines: [{ d: "Work", q: 1, r: 1000 }],
  ...o,
});

describe("deriveHomePipe — six stages, always in order", () => {
  it("returns the pipe in process order, ending at Owed (money still in motion)", () => {
    const out = deriveHomePipe(base);
    expect(out.map((s) => s.key)).toEqual(["new", "quoted", "needsSlot", "trucks", "toBill", "owed"]);
  });
});

describe("NEW stage — top of funnel: no quote out, no job", () => {
  it("counts unquoted, jobless leads incl. Contacted ones, and leaks the unreached", () => {
    const leads: Lead[] = [
      mkLead({ id: "1", stage: "New customer", acts: [] }), // new, untouched → leak
      mkLead({ id: "2", stage: "Contacted", acts: [{ type: "call", when: "9a" }] }), // contacted, no quote → still New
      mkLead({ id: "3", stage: "Won" }), // closed → not New
    ];
    const s = stage(deriveHomePipe({ ...base, leads }), "new");
    expect(s.value).toBe("2"); // both the New and the Contacted-unquoted lead
    expect(s.sub).toBe("1 not reached yet");
    expect(s.leak).toBe(true);
  });

  it("drops a lead out of New once it has a quote out (no double-count with Quoted)", () => {
    const leads = [mkLead({ id: "1", stage: "Quote Sent" })];
    const estimates = [mkEstimate({ id: "est-1", leadId: "1", status: "sent", lines: [{ d: "x", q: 1, r: 900 }] })];
    const out = deriveHomePipe({ ...base, leads, estimates });
    expect(stage(out, "new").value).toBe("0");
    expect(stage(out, "quoted").value).toBe("$900");
  });

  it("drops a lead out of New once it has a job", () => {
    const leads = [mkLead({ id: "1", stage: "Contacted" })];
    const jobs = [mkJob({ id: "1", leadId: "1", status: "unscheduled", visits: [] })];
    expect(stage(deriveHomePipe({ ...base, leads, jobs }), "new").value).toBe("0");
  });

  it("does not leak when every new lead has been reached", () => {
    const leads = [mkLead({ id: "1", stage: "New customer", acts: [{ type: "call", when: "9a" }] })];
    const s = stage(deriveHomePipe({ ...base, leads }), "new");
    expect(s.leak).toBe(false);
    expect(s.sub).toBe("all reached");
  });
});

describe("QUOTED stage", () => {
  it("sums quotes on phones and flags cold ones", () => {
    const leads = [mkLead({ id: "1" }), mkLead({ id: "2" })];
    const estimates: Estimate[] = [
      mkEstimate({ id: "est-1", leadId: "1", lines: [{ d: "a", q: 1, r: 2890 }], reads: [{ when: "today", daysAgo: 0 }] }),
      mkEstimate({ id: "est-2", leadId: "2", lines: [{ d: "b", q: 1, r: 1450 }], reads: [{ when: "4d", daysAgo: 4 }] }), // cold
    ];
    const s = stage(deriveHomePipe({ ...base, leads, estimates }), "quoted");
    expect(s.value).toBe("$4,340");
    expect(s.sub).toBe("2 out · 1 going cold");
    expect(s.leak).toBe(true);
  });
});

describe("job stages", () => {
  it("needs-a-slot sums unscheduled won jobs and leaks", () => {
    const jobs = [mkJob({ id: "1", status: "unscheduled", lines: [{ d: "x", q: 1, r: 2150 }], visits: [] })];
    const s = stage(deriveHomePipe({ ...base, jobs }), "needsSlot");
    expect(s.value).toBe("$2,150");
    expect(s.leak).toBe(true);
  });
  it("on-the-trucks names the on-site crew and never leaks", () => {
    const techs: Tech[] = [mkTech({ id: "5", name: "Carlos Diaz" })];
    const jobs: Job[] = [
      mkJob({
        id: "1",
        status: "scheduled",
        lines: [{ d: "x", q: 1, r: 7200 }],
        visits: [mkVisit({ date: dPlus(0), techId: "5", start: 9, status: "onsite" })],
      }),
    ];
    const s = stage(deriveHomePipe({ ...base, jobs, techs }), "trucks");
    expect(s.value).toBe("$7,200");
    expect(s.sub).toBe("1 today · Carlos on site");
    expect(s.leak).toBe(false);
  });
});

describe("money stages", () => {
  const leads = [mkLead({ id: "1" })];
  const doneUnbilled = mkJob({
    id: "10",
    leadId: "1",
    status: "done",
    lines: [{ d: "x", q: 1, r: 480 }],
    visits: [mkVisit({ date: dPlus(-2), techId: "1", start: 9, status: "done" })],
  });
  const invoices: Invoice[] = [
    mkInvoice({ id: "inv-1", leadId: "1", total: 640, age: 9 }), // overdue, due 640
    mkInvoice({ id: "inv-2", leadId: "1", total: 189, payments: [{ amt: 189, when: "", method: "card" }] }), // paid 189
  ];

  it("to-bill counts ready jobs and leaks", () => {
    const s = stage(deriveHomePipe({ ...base, leads, jobs: [doneUnbilled], invoices }), "toBill");
    expect(s.value).toBe("$480");
    expect(s.sub).toBe("1 done, no invoice");
    expect(s.leak).toBe(true);
  });

  it("owed shows overdue in red, not amber", () => {
    const s = stage(deriveHomePipe({ ...base, leads, jobs: [doneUnbilled], invoices }), "owed");
    expect(s.value).toBe("$640");
    expect(s.red).toBe("$640 overdue");
    expect(s.leak).toBe(false);
  });

  it("has no Collected stage — the pipe ends at money still in motion", () => {
    const out = deriveHomePipe({ ...base, leads, jobs: [doneUnbilled], invoices });
    expect(out.find((s) => s.key === "collected")).toBeUndefined();
  });
});
