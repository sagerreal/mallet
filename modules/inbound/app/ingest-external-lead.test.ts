import { describe, it, expect } from "vitest";
import { IngestExternalLeadUseCase } from "./ingest-external-lead";
import { ok, err, isOk, isErr, validation } from "@mallet/shared/types";

function makeDeps(opts: { reserved?: boolean; ensureErr?: boolean } = {}) {
  const calls = { ensure: 0, reserve: 0, release: 0, touched: 0 };
  const ensure = { exec: async () => { calls.ensure++; return opts.ensureErr ? err(validation("bad", "name")) : ok({ lead: { props: { id: "lead-1" } }, created: true }); } };
  const receipts = {
    reserve: async () => { calls.reserve++; return !opts.reserved; }, // reserved=true → already seen → reserve returns false
    release: async () => { calls.release++; },
  };
  const endpoints = { touchLastLead: async () => { calls.touched++; } };
  const clock = { now: () => new Date("2026-07-12T00:00:00Z") };
  return { uc: new IngestExternalLeadUseCase(ensure as never, receipts as never, endpoints as never, clock as never), calls };
}
const lead = { name: "Gary", phone: "(925) 555-0100", email: null, address: null, notes: null, externalId: "angi-1" };

describe("IngestExternalLeadUseCase", () => {
  it("reserves BEFORE creating; a fresh reservation creates the lead", async () => {
    const { uc, calls } = makeDeps();
    const r = await uc.exec({ channel: "angi", source: "Angi", lead });
    expect(isOk(r) && r.value.outcome).toBe("created");
    expect(calls.reserve).toBe(1);
    expect(calls.ensure).toBe(1);
    expect(calls.release).toBe(0);
    expect(calls.touched).toBe(1);
  });

  it("ignores a duplicate WITHOUT creating (reserve returns false → ensure never called)", async () => {
    const { uc, calls } = makeDeps({ reserved: true });
    const r = await uc.exec({ channel: "angi", source: "Angi", lead });
    expect(isOk(r) && r.value.outcome).toBe("duplicate_ignored");
    expect(calls.reserve).toBe(1);
    expect(calls.ensure).toBe(0); // the key fix: a retried phoneless lead can't double-create
  });

  it("releases the reservation when the create fails, so a retry can succeed", async () => {
    const { uc, calls } = makeDeps({ ensureErr: true });
    const r = await uc.exec({ channel: "angi", source: "Angi", lead });
    expect(isErr(r)).toBe(true);
    expect(calls.reserve).toBe(1);
    expect(calls.ensure).toBe(1);
    expect(calls.release).toBe(1); // rolled back → retry re-reserves
  });

  it("form channel (externalId=null) skips the receipt entirely", async () => {
    const { uc, calls } = makeDeps({ reserved: true });
    const r = await uc.exec({ channel: "form", source: "Website", lead: { ...lead, externalId: null } });
    expect(isOk(r) && r.value.outcome).toBe("created");
    expect(calls.reserve).toBe(0);
    expect(calls.ensure).toBe(1);
  });
});
