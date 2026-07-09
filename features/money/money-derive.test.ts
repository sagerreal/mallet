import { describe, it, expect } from "vitest";
import { dPlus } from "@/lib/prototype-sample";
import type { Invoice, Job, Lead } from "@/lib/store/types";
import { mkJob, mkVisit, mkInvoice, mkLead } from "@/features/jobs/test-factories";
import {
  invPaid,
  invDue,
  invOver,
  invStatusKey,
  INVOICE_OVERDUE_DAYS,
  jobsReadyToInvoice,
  deriveMoneyRows,
  deriveArchivedMoneyRows,
  filterMoneyRows,
} from "./money-derive";

const inv = (o: Partial<Invoice> = {}) => mkInvoice({ status: "sent", ...o });

describe("invoice money math", () => {
  it("sums payments and floors due at zero", () => {
    const i = inv({ total: 1000, depPaid: 200, payments: [{ amt: 300, when: "", method: "card" }] });
    expect(invPaid(i)).toBe(300);
    expect(invDue(i)).toBe(500);
    expect(invDue(inv({ total: 100, depPaid: 0, payments: [{ amt: 150, when: "", method: "cash" }] }))).toBe(0);
  });

  it("flags overdue only past the threshold, never for drafts or paid", () => {
    expect(invOver(inv({ total: 100, age: INVOICE_OVERDUE_DAYS + 1 }))).toBe(true);
    expect(invOver(inv({ total: 100, age: INVOICE_OVERDUE_DAYS }))).toBe(false);
    expect(invOver(inv({ total: 100, age: 20, status: "draft" }))).toBe(false);
    expect(invOver(inv({ total: 100, age: 20, payments: [{ amt: 100, when: "", method: "card" }] }))).toBe(false);
  });

  it("derives the runtime status key", () => {
    expect(invStatusKey(inv({ status: "draft" }))).toBe("draft");
    expect(invStatusKey(inv({ total: 100, age: 9 }))).toBe("over");
    expect(invStatusKey(inv({ total: 100, payments: [{ amt: 100, when: "", method: "card" }] }))).toBe("paid");
    expect(invStatusKey(inv({ total: 100, payments: [{ amt: 40, when: "", method: "card" }] }))).toBe("partial");
    expect(invStatusKey(inv({ total: 100 }))).toBe("sent");
  });
});

describe("jobsReadyToInvoice", () => {
  it("finds done jobs with no invoice, skipping archived jobs", () => {
    const jobs: Job[] = [
      mkJob({ id: "1", status: "done" }),
      mkJob({ id: "2", status: "done" }),
      mkJob({ id: "3", status: "scheduled" }),
      mkJob({ id: "4", status: "done", archived: true }),
    ];
    const invoices = [inv({ id: "inv-1", jobId: "2" })];
    expect(jobsReadyToInvoice(jobs, invoices).map((j) => j.id)).toEqual(["1"]);
  });
});

describe("deriveMoneyRows — one ledger, needs-you first", () => {
  const leads: Lead[] = [mkLead({ id: "1", name: "Priya Shah" }), mkLead({ id: "2", name: "Tom Webb" })];
  const doneJob = mkJob({
    id: "10",
    leadId: "1",
    title: "Hose bib rebuild",
    status: "done",
    lines: [{ d: "Rebuild", q: 1, r: 480 }],
    visits: [mkVisit({ date: dPlus(-2), techId: "1", start: 9, status: "done" })],
  });

  it("ranks ready → draft → overdue → part-paid → unpaid → paid", () => {
    const invoices = [
      inv({ id: "inv-1", leadId: "2", total: 100, payments: [{ amt: 100, when: "", method: "card" }] }), // paid
      inv({ id: "inv-2", leadId: "2", total: 640, age: 9 }), // over
      inv({ id: "inv-3", leadId: "2", total: 300, status: "draft" }), // draft
      inv({ id: "inv-4", leadId: "2", total: 420, payments: [{ amt: 100, when: "", method: "card" }], age: 1 }), // partial
      inv({ id: "inv-5", leadId: "2", total: 200, age: 1 }), // sent
    ];
    const rows = deriveMoneyRows(invoices, [doneJob], leads);
    expect(rows.map((r) => r.statusKey)).toEqual(["ready", "draft", "over", "partial", "sent", "paid"]);
    expect(rows[0]!.kind).toBe("ready");
    expect(rows[0]!.num).toBeNull();
    expect(rows[0]!.due).toBe(480);
    expect(rows[0]!.cust).toBe("Priya Shah");
  });

  it("annotates reminder trails and cards on file", () => {
    const cardLead = mkLead({ id: "3", name: "Sofia", card: { brand: "Visa", last4: "4242", via: "sms" } });
    const invoices = [
      inv({ id: "inv-1", leadId: "2", total: 640, age: 9, fu: { on: true, stage: 2 } }),
      inv({ id: "inv-2", leadId: "3", total: 420, age: 1 }),
    ];
    const rows = deriveMoneyRows(invoices, [], [...leads, cardLead]);
    expect(rows.find((r) => r.key === "inv-1")?.sub).toBe("2 reminders sent");
    expect(rows.find((r) => r.key === "inv-2")?.sub).toBe("Visa ···· 4242 on file");
    expect(rows.find((r) => r.key === "inv-2")?.card?.last4).toBe("4242");
  });

  it("excludes archived invoices from active and includes them in archived", () => {
    const invoices = [inv({ id: "inv-1", leadId: "2", total: 100 }), inv({ id: "inv-2", leadId: "2", total: 200, archived: true })];
    expect(deriveMoneyRows(invoices, [], leads).map((r) => r.key)).toEqual(["inv-1"]);
    expect(deriveArchivedMoneyRows(invoices, leads).map((r) => r.key)).toEqual(["inv-2"]);
  });
});

describe("filterMoneyRows — status filter + search narrow the one set", () => {
  const leads = [mkLead({ id: "1", name: "Tom Webb" }), mkLead({ id: "2", name: "Sofia Hernandez" })];
  const rows = deriveMoneyRows(
    [
      inv({ id: "inv-1", leadId: "1", num: "INV-2042", title: "Sewer camera", total: 640, age: 9 }), // over
      inv({ id: "inv-2", leadId: "2", num: "INV-2043", title: "Valves", total: 420, age: 1 }), // sent
      inv({ id: "inv-3", leadId: "2", num: "INV-2041", title: "Tune-up", total: 189, payments: [{ amt: 189, when: "", method: "card" }] }), // paid
    ],
    [],
    leads
  );

  it("status filter narrows to one status", () => {
    expect(filterMoneyRows(rows, { statusFilter: "paid", q: "" }).map((r) => r.num)).toEqual(["INV-2041"]);
    expect(filterMoneyRows(rows, { statusFilter: "over", q: "" }).map((r) => r.num)).toEqual(["INV-2042"]);
  });

  it("search matches #, customer, and job, stacking on the status filter", () => {
    expect(filterMoneyRows(rows, { statusFilter: "", q: "sofia" })).toHaveLength(2);
    expect(filterMoneyRows(rows, { statusFilter: "sent", q: "sofia" }).map((r) => r.num)).toEqual(["INV-2043"]);
    expect(filterMoneyRows(rows, { statusFilter: "", q: "2042" })).toHaveLength(1);
    expect(filterMoneyRows(rows, { statusFilter: "", q: "tune" }).map((r) => r.num)).toEqual(["INV-2041"]);
  });
});
