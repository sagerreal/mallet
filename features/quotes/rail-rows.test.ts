import { describe, it, expect } from "vitest";
import { railRowsFor, wonRowsFor } from "./derive";
import type { Estimate, Lead } from "@/lib/store/types";

const mkLead = (over: Partial<Lead> = {}): Lead => ({
  id: "lead-default", name: "Test Customer", phone: "", source: "", stage: "lead",
  age: 0, job: "", last: "", archived: false, ...over,
});

const mkEstimate = (over: Partial<Estimate> = {}): Estimate => ({
  id: "est-default", num: "EST-1", leadId: "lead-default", title: "Test estimate",
  status: "sent", age: 1, viewed: false, fu: { on: false, stage: 0 }, lines: [],
  archived: false, trash: false, reads: [], ...over,
});

/**
 * THE BUG. The Pipeline's Out and Won columns paired each quote with its customer by searching the
 * browser's loaded customers, and dropped any quote whose customer was not found. Both collections
 * are capped at one page, so on a big enough book a quote was silently removed from the column —
 * no error, just a missing card — while the header count (which comes from the database) still
 * counted it. Two numbers on the same column, disagreeing.
 *
 * The fix is that the quote arrives with its customer's NAME already attached, so there is no
 * lookup left to fail.
 */

const sent = (over: Partial<Estimate> = {}): Estimate =>
  mkEstimate({ id: "e1", leadId: "off-page", status: "sent", ...over });

describe("rail rows built from server-selected quotes", () => {
  it("keeps a quote whose customer is NOT in the loaded set", () => {
    const rows = railRowsFor([{ est: sent(), customerName: "Zsofia Quennell" }], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.customerName).toBe("Zsofia Quennell");
  });


  it("prefers the server's name over a stale store copy", () => {
    const leads: Lead[] = [mkLead({ id: "off-page", name: "Old Name" })];
    const rows = railRowsFor([{ est: sent(), customerName: "New Name" }], leads);
    expect(rows[0]!.customerName).toBe("New Name");
  });

  it("still attaches the full customer when it IS loaded — the card's send actions need it", () => {
    const leads: Lead[] = [mkLead({ id: "off-page", name: "Zsofia Quennell" })];
    const rows = railRowsFor([{ est: sent(), customerName: "Zsofia Quennell" }], leads);
    expect(rows[0]!.lead?.id).toBe("off-page");
  });

  it("falls back to a dash only when nobody supplied a name", () => {
    const rows = railRowsFor([{ est: sent(), customerName: null }], []);
    expect(rows[0]!.customerName).toBe("—");
  });

  it("orders Out by how quiet the quote has gone, then by size", () => {
    const rows = railRowsFor(
      [
        { est: sent({ id: "small", lines: [{ d: "x", q: 1, r: 100 }] }), customerName: "A" },
        { est: sent({ id: "big", lines: [{ d: "x", q: 1, r: 9000 }] }), customerName: "B" },
      ],
      [],
    );
    expect(rows.map((r) => r.est.id)).toEqual(["big", "small"]);
  });

  it("keeps a WON quote whose customer is not loaded", () => {
    const rows = wonRowsFor(
      [{ est: mkEstimate({ id: "w1", leadId: "off-page", status: "accepted", age: 1 }), customerName: "Zsofia Quennell" }],
      [],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.customerName).toBe("Zsofia Quennell");
    // No job loaded for it, so it reads as work still to be booked rather than as scheduled.
    expect(rows[0]!.unscheduled).toBe(true);
  });
});
