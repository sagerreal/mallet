/**
 * The ledger's derivations. What matters: the trade's words for the domain's states, archived
 * paper off the book, the out-the-door figure counting only SENT paper, and the customer's
 * change request surfacing as its own pill — the row that needs the office's eye first.
 */
import { describe, it, expect } from "vitest";
import { bucketOf, pillOf, ledgerRows, ledgerCounts } from "./quotes-ledger-utils";
import type { Estimate, Lead } from "@/lib/store/types";

const est = (over: Partial<Estimate> = {}): Estimate =>
  ({
    id: "e1",
    leadId: "l1",
    title: "Water heater swap",
    status: "sent",
    age: 2,
    cachedTotal: 2450,
    lines: [],
    ...over,
  }) as unknown as Estimate;

const leads = [
  { id: "l1", name: "Dana Alvarez" },
  { id: "l2", name: "Marta Delgado" },
] as unknown as Lead[];

describe("bucketOf — the domain's states in the trade's words", () => {
  it("maps accepted → won and declined → lost, the same dialect the stage chips speak", () => {
    expect(bucketOf(est({ status: "accepted" }))).toBe("won");
    expect(bucketOf(est({ status: "declined" }))).toBe("lost");
    expect(bucketOf(est({ status: "sent" }))).toBe("sent");
    expect(bucketOf(est({ status: "draft" }))).toBe("draft");
  });

  it("trash is off the book entirely", () => {
    expect(bucketOf(est({ trash: true }))).toBeNull();
  });
});

describe("pillOf", () => {
  it("a sent quote whose customer asked for changes says so", () => {
    expect(pillOf(est({ changeRequestedAt: "2026-08-10T12:00:00Z" }), "sent")).toEqual({
      label: "Changes asked",
      tone: "amber",
    });
    expect(pillOf(est(), "sent")).toEqual({ label: "Sent", tone: "amber" });
  });

  it("won is green, lost is red, draft is gray — never blue", () => {
    expect(pillOf(est({ status: "accepted" }), "won").tone).toBe("green");
    expect(pillOf(est({ status: "declined" }), "lost").tone).toBe("red");
    expect(pillOf(est({ status: "draft" }), "draft").tone).toBe("gray");
  });
});

describe("ledgerRows", () => {
  const book = [
    est({ id: "e1", leadId: "l1", age: 2 }),
    est({ id: "e2", leadId: "l2", title: "Repipe, whole house", status: "draft", age: 0, cachedTotal: 11800 }),
    est({ id: "e3", leadId: "l1", title: "Old archived", archived: true }),
    est({ id: "e4", leadId: "l2", title: "Declined remodel", status: "declined", age: 14 }),
  ];

  it("filters by bucket and hides archived paper", () => {
    const all = ledgerRows(book, leads, "all", "");
    expect(all.map((r) => r.id)).toEqual(["e2", "e1", "e4"]); // newest first
    expect(ledgerRows(book, leads, "lost", "").map((r) => r.id)).toEqual(["e4"]);
  });

  it("searches customer AND title as one string", () => {
    expect(ledgerRows(book, leads, "all", "repipe").map((r) => r.id)).toEqual(["e2"]);
    expect(ledgerRows(book, leads, "all", "dana").map((r) => r.id)).toEqual(["e1"]);
  });

  it("names the customer, and a missing lead renders a dash rather than a crash", () => {
    const rows = ledgerRows([est({ leadId: "gone" })], leads, "all", "");
    expect(rows[0]!.customer).toBe("—");
  });

  it("ages read today / Nd in the mono register", () => {
    const rows = ledgerRows(book, leads, "all", "");
    expect(rows.map((r) => r.ageLabel)).toEqual(["today", "2d", "14d"]);
  });
});

describe("ledgerCounts", () => {
  it("out-the-door sums SENT paper only — won money is not sitting on a phone", () => {
    const c = ledgerCounts([
      est({ id: "a", cachedTotal: 2450 }),
      est({ id: "b", status: "sent", cachedTotal: 1540 }),
      est({ id: "c", status: "accepted", cachedTotal: 4980 }),
      est({ id: "d", status: "draft", cachedTotal: 9200 }),
      est({ id: "e", archived: true, cachedTotal: 100 }),
    ]);
    expect(c).toMatchObject({ all: 4, sent: 2, won: 1, draft: 1, lost: 0 });
    expect(c.outTheDoorDollars).toBe(3990);
  });
});

// Owen, Aug 11: "there should be some apparent way to see the change requested for quotes."
// The pill alone meant scanning the table; "changes" is now a first-class filter with a count.
describe("the Changes-asked filter", () => {
  const book = [
    est({ id: "c1", changeRequestedAt: "2026-08-11T10:00:00Z" }),
    est({ id: "c2" }),
    est({ id: "c3", status: "draft" }),
  ];

  it("counts sent quotes carrying a change request", () => {
    expect(ledgerCounts(book).changes).toBe(1);
  });

  it("filters the ledger to exactly those quotes", () => {
    expect(ledgerRows(book, leads, "changes", "").map((r) => r.id)).toEqual(["c1"]);
  });

  it("a change request on non-sent paper does not count — the customer answers SENT quotes", () => {
    const stale = [est({ id: "c4", status: "accepted", changeRequestedAt: "2026-08-11T10:00:00Z" })];
    expect(ledgerCounts(stale).changes).toBe(0);
    expect(ledgerRows(stale, leads, "changes", "")).toEqual([]);
  });
});
