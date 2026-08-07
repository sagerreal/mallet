/**
 * features/board/derive.test.ts
 * Fixture literals only — no store, no barrels, no React. Every exported
 * derivation gets at least one behaviour test.
 */

import { describe, expect, it } from "vitest";
import {
  billingItems,
  columnOf,
  jobItem,
  needsYouOf,
  quotingItems,
  rankItems,
  requestItem,
} from "./derive";
import type { BoardItem } from "./types";
import type { OkItem } from "@/features/home/derive";
import type { RailRow } from "@/features/quotes/derive";
import type { GettingRow } from "@/features/pipeline/working";
import type { Estimate, Invoice, Job, Lead, Visit } from "@/lib/store/types";

// ---- fixtures ---------------------------------------------------------------

const item = (over: Partial<BoardItem>): BoardItem => ({
  key: "bj-1", kind: "job", column: "jobs", refId: "1", name: "A", service: "s",
  valueDollars: 0, stateLabel: "Scheduled", tone: "waiting", needsAction: false,
  ageLabel: "", ...over,
});

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: "l1", name: "Maria Ortiz", phone: "555-0100", source: "web", stage: "New customer",
  age: 2, job: "Water heater leaking", last: "", ...over,
});

const estimate = (over: Partial<Estimate> = {}): Estimate => ({
  id: "e1", num: "EST-1001", leadId: "l1", title: "Water heater replacement",
  status: "sent", age: 4, viewed: true, fu: { on: false, stage: 0 }, lines: [], ...over,
});

const visit = (over: Partial<Visit> = {}): Visit => ({
  id: "v1", date: "2026-08-10", techId: "t1", start: 8, dur: 2, status: "scheduled", ...over,
});

const job = (over: Partial<Job> = {}): Job => ({
  id: "j1", leadId: "l1", svc: "plumbing", kind: "work", origin: "db",
  title: "Water heater replacement", addr: "12 Elm St", phone: "555-0100",
  status: "scheduled", archived: false, lines: [{ d: "Install", q: 1, r: 1800 }],
  addons: [], photos: [], notes: "", acts: [], visits: [visit()], ...over,
});

const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: "i1", num: "INV-2001", jobId: "j1", leadId: "l1", cust: "Maria Ortiz",
  phone: "555-0100", title: "Water heater replacement", lines: [], total: 1325,
  depPaid: 0, payments: [], status: "sent", age: 30, archived: false, ...over,
});

/**
 * Past its due date and still owed — the "over" branch of invStatusKey. Local-noon anchored so
 * the day count is the same in every timezone; the clock mock pins "today" to 2026-07-01.
 */
const overdueInvoiceFixture = invoice({ dueAt: "2026-06-01T12:00:00" });

/** A LIST-hydrated bill: the hydrator blanks `cust`, and the balance comes from the server. */
const listRowInvoice = invoice({
  id: "i2", cust: "", partial: true, due: 400, paidTotal: 925, dueAt: null, status: "partial",
});

const NO_NAMES: ReadonlyMap<string, string> = new Map();

const okFor = (key: string, value: number): OkItem =>
  ({ key, kind: "invoice-overdue", value } as OkItem);

const railRow = (over: Partial<RailRow> = {}): RailRow => ({
  est: estimate(), customerName: "Maria Ortiz", lead: null, total: 2890,
  quietDays: 3, cool: 0.64, rings: 1, live: false, stamp: "Quiet 3 days", ...over,
});

const gettingRow = (over: Partial<GettingRow> = {}): GettingRow => ({
  lead: lead(), est: null, kind: "visit", stamp: "walkthrough Friday", verb: null,
  scopeVisitJobId: null, ...over,
});

// ---- rankItems ---------------------------------------------------------------

describe("rankItems", () => {
  it("pins needs-action first, then value desc, then name", () => {
    const ranked = rankItems([
      item({ key: "a", needsAction: false, valueDollars: 900 }),
      item({ key: "b", needsAction: true, valueDollars: 100 }),
      item({ key: "c", needsAction: true, valueDollars: 500 }),
    ]);
    expect(ranked.map((i) => i.key)).toEqual(["c", "b", "a"]);
  });

  it("breaks a value tie on name, ascending, and never mutates the input", () => {
    const input = [
      item({ key: "z", name: "Zoe", valueDollars: 300 }),
      item({ key: "a", name: "Abel", valueDollars: 300 }),
    ];
    expect(rankItems(input).map((i) => i.name)).toEqual(["Abel", "Zoe"]);
    expect(input.map((i) => i.key)).toEqual(["z", "a"]);
  });
});

// ---- columnOf / needsYouOf ----------------------------------------------------

describe("columnOf", () => {
  it("column dollars ignore unpriced items and prefer server figures", () => {
    const col = columnOf("jobs", "Jobs", [item({ valueDollars: 0 }), item({ key: "x", valueDollars: 250 })]);
    expect(col.valueDollars).toBe(250);
    const withServer = columnOf("jobs", "Jobs", [], { serverDollars: 6014, serverCount: 4 });
    expect(withServer.valueDollars).toBe(6014);
    expect(withServer.count).toBe(4);
  });

  it("ranks its items and defaults truncated to false", () => {
    const col = columnOf("jobs", "Jobs", [
      item({ key: "passive", needsAction: false, valueDollars: 900 }),
      item({ key: "urgent", needsAction: true, valueDollars: 10 }),
    ]);
    expect(col.items.map((i) => i.key)).toEqual(["urgent", "passive"]);
    expect(col.truncated).toBe(false);
    expect(col.id).toBe("jobs");
    expect(col.title).toBe("Jobs");
  });

  it("passes a capped column's truncated flag through", () => {
    expect(columnOf("jobs", "Jobs", [item({})], { truncated: true }).truncated).toBe(true);
  });

  it("falls back to the page when a server figure is not a number", () => {
    const col = columnOf("jobs", "Jobs", [item({ valueDollars: 250 })], {
      serverCount: Number.NaN,
      serverDollars: Number.NaN,
    });
    expect(col.count).toBe(1);
    expect(col.valueDollars).toBe(250);
  });
});

describe("needsYouOf", () => {
  it("counts only needs-action items and sums their dollars", () => {
    const columns = [
      columnOf("requests", "New requests", [item({ key: "r1", needsAction: true, valueDollars: 0 })]),
      columnOf("jobs", "Jobs", [
        item({ key: "j1", needsAction: true, valueDollars: 1800 }),
        item({ key: "j2", needsAction: false, valueDollars: 9999 }),
      ]),
    ];
    expect(needsYouOf(columns)).toEqual({ count: 2, valueDollars: 1800, textsReady: 0 });
  });

  it("counts a text as ready only when the item also needs action", () => {
    const ok = okFor("oki-i1", 1325);
    const columns = [
      columnOf("billing", "Billing", [
        item({ key: "b1", needsAction: true, valueDollars: 100, ok }),
        item({ key: "b2", needsAction: false, valueDollars: 100, ok }),
      ]),
    ];
    expect(needsYouOf(columns).textsReady).toBe(1);
  });
});

// ---- requestItem --------------------------------------------------------------

describe("requestItem", () => {
  it("is always attention and needs a response", () => {
    const it0 = requestItem(lead({ value: 0 }));
    expect(it0).toMatchObject({
      key: "bl-l1", kind: "lead", column: "requests", refId: "l1", leadId: "l1",
      name: "Maria Ortiz", service: "Water heater leaking", valueDollars: 0,
      stateLabel: "Needs response", tone: "attention", needsAction: true,
    });
    expect(it0.ageLabel).not.toBe("");
  });

  it("carries the lead's value when it has one, and 0 when it does not", () => {
    expect(requestItem(lead({ value: 450 })).valueDollars).toBe(450);
    expect(requestItem(lead()).valueDollars).toBe(0);
  });
});

// ---- quotingItems -------------------------------------------------------------

describe("quotingItems", () => {
  it("a sent quote with no reminder waits on the customer", () => {
    const [row] = quotingItems([], [railRow()], new Map());
    expect(row).toMatchObject({
      key: "be-e1", kind: "estimate", column: "quoting", refId: "e1", leadId: "l1",
      name: "Maria Ortiz", service: "Water heater replacement", valueDollars: 2890,
      stateLabel: "Awaiting customer", tone: "waiting", needsAction: false,
      ageLabel: "Quiet 3 days",
    });
    expect(row?.ok).toBeUndefined();
  });

  it("a sent quote with a prepared reminder needs action and carries the text", () => {
    const ok = okFor("okq-e1", 2890);
    const [row] = quotingItems([], [railRow()], new Map([["e1", ok]]));
    expect(row).toMatchObject({
      stateLabel: "Reminder due", tone: "attention", needsAction: true, ok,
    });
  });

  it("a booked walkthrough is passive; a returned scope and a draft are the office's move", () => {
    const rows = quotingItems(
      [
        gettingRow({ kind: "visit" }),
        gettingRow({ kind: "scoped", stamp: "scoped today", scopeVisitJobId: "j9" }),
        gettingRow({ kind: "shop", est: estimate({ status: "draft", cachedTotal: 1200 }), stamp: "in the shop" }),
      ],
      [],
      new Map(),
    );
    expect(rows.map((r) => [r.stateLabel, r.needsAction, r.tone])).toEqual([
      ["Walkthrough booked", false, "waiting"],
      ["Needs quote", true, "attention"],
      ["Draft in progress", true, "attention"],
    ]);
    // No estimate yet ⇒ the card opens the customer; a draft opens the quote.
    expect(rows[0]).toMatchObject({ key: "bl-l1", kind: "lead", refId: "l1", valueDollars: 0 });
    expect(rows[2]).toMatchObject({ key: "be-e1", kind: "estimate", refId: "e1", valueDollars: 1200 });
  });
});

// ---- jobItem ------------------------------------------------------------------

describe("jobItem", () => {
  it("a job with no placed visit needs scheduling", () => {
    const row = jobItem(job({ visits: [] }), "Maria Ortiz");
    expect(row).toMatchObject({
      key: "bj-j1", kind: "job", column: "jobs", refId: "j1", leadId: "l1",
      name: "Maria Ortiz", service: "Water heater replacement", valueDollars: 1800,
      stateLabel: "Needs scheduling", tone: "attention", needsAction: true, ageLabel: "",
    });
  });

  it("a placed visit reads as scheduled with the visit's own label", () => {
    const row = jobItem(job(), "Maria Ortiz");
    expect(row).toMatchObject({ stateLabel: "Scheduled", tone: "waiting", needsAction: false });
    expect(row.ageLabel).toBe("Mon 8:00 AM");
  });

  it("a crew on the way and a crew on site both read as active work, not a task", () => {
    const enroute = jobItem(job({ visits: [visit({ status: "enroute" })] }), "Maria Ortiz");
    expect(enroute).toMatchObject({ stateLabel: "En route", tone: "active", needsAction: false });
    const onsite = jobItem(job({ visits: [visit({ status: "onsite" })] }), "Maria Ortiz");
    expect(onsite).toMatchObject({ stateLabel: "On site", tone: "active", needsAction: false });
  });

  it("arrival outranks the trip when both stamps are on the job", () => {
    const row = jobItem(
      job({ visits: [visit({ id: "v1", status: "enroute" }), visit({ id: "v2", status: "onsite" })] }),
      "Maria Ortiz",
    );
    expect(row.stateLabel).toBe("On site");
  });

  it("says so plainly when the DTO resolved no name", () => {
    expect(jobItem(job(), null).name).toBe("—");
  });
});

// ---- billingItems -------------------------------------------------------------

describe("billingItems", () => {
  it("overdue invoices carry their OkItem and count as texts ready", () => {
    const ok = okFor("oki-i1", 1325);
    const items = billingItems([], [overdueInvoiceFixture], new Map([["i1", ok]]), NO_NAMES, NO_NAMES);
    expect(items[0]).toMatchObject({ tone: "overdue", needsAction: true, ok });
    expect(needsYouOf([columnOf("billing", "Billing", items)]).textsReady).toBe(1);
  });

  it("an overdue bill is aged against its DUE date, not the day it was raised", () => {
    const [row] = billingItems([], [overdueInvoiceFixture], new Map(), NO_NAMES, NO_NAMES);
    // Pinned clock: 2026-07-01. Due 2026-06-01. `age: 30` is deliberately a different number.
    expect(row?.ageLabel).toBe("Due 30d ago");
  });

  it("every other bill states when it was raised", () => {
    const [row] = billingItems(
      [], [invoice({ id: "d1", status: "draft", age: 0 })], new Map(), NO_NAMES, NO_NAMES,
    );
    expect(row?.ageLabel).toBe("Raised today");
  });

  it("fills a list-hydrated bill's blank name from the invoice name seam", () => {
    const named = new Map([["i2", "Dana Whitfield"]]);
    const [row] = billingItems([], [listRowInvoice], new Map(), NO_NAMES, named);
    expect(row).toMatchObject({ key: "bi-i2", name: "Dana Whitfield", valueDollars: 400 });
    // Without the seam there is nothing to print — the hydrator wrote "".
    const [bare] = billingItems([], [listRowInvoice], new Map(), NO_NAMES, NO_NAMES);
    expect(bare?.name).toBe("—");
  });

  it("a done, unbilled job is ready to bill, aged by how long the money has sat", () => {
    const done = job({ status: "done", visits: [visit({ date: "2026-06-28", status: "done" })] });
    const [row] = billingItems([done], [], new Map(), new Map([["j1", "Maria Ortiz"]]), NO_NAMES);
    expect(row).toMatchObject({
      key: "bj-j1", kind: "job", column: "billing", refId: "j1", name: "Maria Ortiz",
      valueDollars: 1800, stateLabel: "Ready to bill", tone: "attention", needsAction: true,
      ageLabel: "Done 3d ago",
    });
  });

  it("drafts need action; sent and part-paid bills wait; paid bills leave the board", () => {
    const items = billingItems(
      [],
      [
        invoice({ id: "d1", status: "draft", age: 0 }),
        invoice({ id: "s1", status: "sent", dueAt: null }),
        invoice({ id: "p1", status: "partial", partial: true, due: 400, dueAt: null }),
        invoice({ id: "paid1", status: "paid", total: 500, paidTotal: 500 }),
      ],
      new Map(),
      NO_NAMES,
      NO_NAMES,
    );
    expect(items.map((i) => [i.refId, i.stateLabel, i.needsAction, i.valueDollars])).toEqual([
      ["d1", "Draft invoice", true, 1325],
      ["s1", "Awaiting payment", false, 1325],
      ["p1", "Awaiting payment", false, 400],
    ]);
    expect(items.every((i) => i.column === "billing" && i.kind === "invoice")).toBe(true);
  });

  it("skips archived invoices", () => {
    expect(billingItems([], [invoice({ archived: true })], new Map(), NO_NAMES, NO_NAMES)).toEqual([]);
  });
});
