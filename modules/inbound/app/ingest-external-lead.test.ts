import { describe, it, expect, beforeEach } from "vitest";
import { IngestExternalLeadUseCase } from "./ingest-external-lead";
import { ok, isOk } from "@mallet/shared/types";

function makeDeps(receiptSeen = false) {
  const calls = { ensure: [] as unknown[], touched: [] as unknown[] };
  const ensure = { exec: async (cmd: unknown) => { calls.ensure.push(cmd); return ok({ lead: { props: { id: "lead-1" } }, created: true }); } };
  const receipts = { recordIfNew: async () => !receiptSeen }; // false => already seen
  const endpoints = { touchLastLead: async (...a: unknown[]) => { calls.touched.push(a); } };
  const clock = { now: () => new Date("2026-07-12T00:00:00Z") };
  return { uc: new IngestExternalLeadUseCase(ensure as never, receipts as never, endpoints as never, clock as never), calls };
}
const lead = { name: "Gary", phone: "(925) 555-0100", email: null, address: null, notes: null, externalId: "angi-1" };

describe("IngestExternalLeadUseCase", () => {
  it("creates a customer and stamps last_lead_at", async () => {
    const { uc, calls } = makeDeps();
    const r = await uc.exec({ channel: "angi", source: "Angi", lead });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.outcome).toBe("created");
    expect(calls.ensure).toHaveLength(1);
    expect(calls.touched).toHaveLength(1);
  });
  it("reports an already-received external_id as duplicate_ignored without re-touching the endpoint", async () => {
    const { uc, calls } = makeDeps(true);
    const r = await uc.exec({ channel: "angi", source: "Angi", lead });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.outcome).toBe("duplicate_ignored");
    // Ordering (see brief NOTE, kept intentionally): the receipt guard runs AFTER EnsureCustomer
    // because recordIfNew needs the resulting leadId, so ensureCustomer IS still called on a
    // retry — its own phone dedupe is the backstop that prevents a second customer record.
    // What must NOT happen twice is the caller-visible side effect: last_lead_at is only
    // touched once, on the delivery that actually wins the receipt race.
    expect(calls.ensure).toHaveLength(1);
    expect(calls.touched).toHaveLength(0);
  });
  it("skips the receipt guard when externalId is null (form channel)", async () => {
    const { uc, calls } = makeDeps(true); // even if recordIfNew would say seen, null id skips it
    const r = await uc.exec({ channel: "form", source: "Website", lead: { ...lead, externalId: null } });
    if (isOk(r)) expect(r.value.outcome).toBe("created");
    expect(calls.ensure).toHaveLength(1);
  });
});
