import { describe, it, expect } from "vitest";
import { dPlus } from "@/lib/prototype-sample";
import type { Invoice, Job, Lead } from "@/lib/store/types";
import { mkJob, mkVisit, mkInvoice, mkLead } from "@/features/jobs/test-factories";
import { dtoJobToStoreJob } from "@/lib/store/dto-mapper";
import {
  invPaid,
  invDue,
  invOver,
  invStatusKey,
  jobsReadyToInvoice,
  deriveMoneyRows,
  deriveArchivedMoneyRows,
} from "./money-derive";

const inv = (o: Partial<Invoice> = {}) => mkInvoice({ status: "sent", ...o });

describe("invoice money math", () => {
  it("sums payments and floors due at zero", () => {
    const i = inv({ total: 1000, depPaid: 200, payments: [{ amt: 300, when: "", method: "card" }] });
    expect(invPaid(i)).toBe(300);
    expect(invDue(i)).toBe(500);
    expect(invDue(inv({ total: 100, depPaid: 0, payments: [{ amt: 150, when: "", method: "cash" }] }))).toBe(0);
  });

  // Overdue is PAST THE AGREED DUE DATE, not a fixed number of days since the invoice was raised.
  // The old rule ignored the customer's terms and — because dtoInvoiceToStore hard-coded age: 0 —
  // could never be true for an invoice loaded from the database.
  it("flags overdue past the due date, never for drafts, settled invoices, or no due date", () => {
    const NOW = new Date("2026-07-30T12:00:00Z");
    expect(invOver(inv({ total: 100, dueAt: "2026-07-29" }), NOW)).toBe(true);
    expect(invOver(inv({ total: 100, dueAt: "2026-08-15" }), NOW)).toBe(false);
    expect(invOver(inv({ total: 100, dueAt: "2026-07-01", status: "draft" }), NOW)).toBe(false);
    expect(
      invOver(inv({ total: 100, dueAt: "2026-07-01", payments: [{ amt: 100, when: "", method: "card" }] }), NOW),
    ).toBe(false);
    // Nothing was promised, so nothing was missed.
    expect(invOver(inv({ total: 100, dueAt: null }), NOW)).toBe(false);
  });

  // A net-30 invoice raised three weeks ago is NOT late. The old age-threshold rule called it late
  // on day eight, contradicting the terms the shop actually gave the customer.
  it("respects long terms instead of flagging every invoice after a week", () => {
    expect(invOver(inv({ total: 100, dueAt: "2026-08-20" }), new Date("2026-07-30T12:00:00Z"))).toBe(false);
  });

  it("derives the runtime status key", () => {
    expect(invStatusKey(inv({ status: "draft" }))).toBe("draft");
    expect(invStatusKey(inv({ total: 100, dueAt: "2020-01-01" }))).toBe("over");
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

  // Money-on-the-floor regression: a job completed straight from My Day — one visit,
  // complete, its scheduled_date NEVER set because nobody dragged it onto the Schedule
  // board — must still surface as ready to bill. Goes through the real dtoJobToStoreJob
  // mapper (not mkJob) so this exercises the actual DTO→store status derivation, not just
  // jobsReadyToInvoice's own (trivial) status check.
  it("includes a complete job whose only visit was never placed on the Schedule board", () => {
    const dto = {
      id: "job-1015",
      num: "JOB-1015",
      leadId: "lead-1",
      sourceEstimateId: null,
      assigneeUserId: null,
      title: "Drain cleaning",
      status: "complete" as const,
      scheduledStart: null,
      scheduledEnd: null,
      startedAt: null,
      completedAt: "2026-07-30T00:00:00.000Z",
      canceledAt: null,
      cancelReason: null,
      total: { cents: 19_500, currency: "USD" as const },
      notes: "",
      svc: "service",
      createdAt: "2026-07-28T00:00:00.000Z",
      visits: [
        {
          id: "visit-1",
          assigneeUserId: "tech-1",
          scheduledDate: null,
          scheduledStart: null,
          scheduledEnd: null,
          durationMinutes: 30,
          status: "complete" as const,
          enrouteAt: null,
          startedAt: "2026-07-30T00:00:00.000Z",
          completedAt: "2026-07-30T00:15:00.000Z",
          notes: null,
          position: 0,
        },
      ],
    };
    const job = dtoJobToStoreJob(dto as never);
    expect(jobsReadyToInvoice([job], [])).toEqual([job]);
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
      inv({ id: "inv-2", leadId: "2", total: 640, dueAt: "2020-01-01" }), // over — past its due date
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

  // Under a status filter the database already answered in the order that band is read in, and
  // one page of a 583-row book must not be reordered on arrival. Inside the Paid band every row
  // ties on rank AND on balance, so the old sort fell through to ageDays DESCENDING — oldest
  // first — and put the payment the owner had just taken at the bottom of the page he had
  // filtered to go and find it on.
  it("keeps the database's order when the screen has filtered to one band", () => {
    const settledToday = inv({ id: "inv-new", leadId: "2", total: 185, age: 0, payments: [{ amt: 185, when: "", method: "cash" }] });
    const settledLastYear = inv({ id: "inv-old", leadId: "2", total: 400, age: 340, payments: [{ amt: 400, when: "", method: "card" }] });
    // The order the Paid view returns: most recently settled first.
    const serverOrder = [settledToday, settledLastYear];

    expect(deriveMoneyRows(serverOrder, [], leads, true).map((r) => r.key)).toEqual(["inv-new", "inv-old"]);
    // Unfiltered, the client sort still runs and still ranks by age within the band.
    expect(deriveMoneyRows(serverOrder, [], leads).map((r) => r.key)).toEqual(["inv-old", "inv-new"]);
  });

  it("keeps archived invoices out of the active ledger", () => {
    // Belt and braces: the SERVER now excludes void from the live set too (InvoiceFilter.archived),
    // so this filter should never have anything to remove. It stays because a void invoice reaching
    // the active ledger would be counted as money owed.
    const invoices = [inv({ id: "inv-1", leadId: "2", total: 100 }), inv({ id: "inv-2", leadId: "2", total: 200, archived: true })];
    expect(deriveMoneyRows(invoices, [], leads).map((r) => r.key)).toEqual(["inv-1"]);
  });

  it("renders the archived page the SERVER sent, without re-filtering it", () => {
    // This used to be `invoices.filter(i => i.archived)` over whichever page happened to be loaded,
    // so the Archived tab could only find a void invoice inside the first fifty rows of a list that
    // was not fetched for that purpose. The query asks for them now; re-filtering could only lose
    // rows the server deliberately returned.
    const page = [inv({ id: "void-1", leadId: "2", total: 200 }), inv({ id: "void-2", leadId: "2", total: 300 })];
    expect(deriveArchivedMoneyRows(page, leads).map((r) => r.key)).toEqual(["void-1", "void-2"]);
  });
});

