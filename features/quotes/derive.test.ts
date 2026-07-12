/**
 * features/quotes/derive.test.ts
 * Unit tests for the pure deriveRail function.
 */

import { describe, it, expect } from "vitest";
import { deriveRail } from "./derive";
import type { Estimate, Lead } from "@/lib/store/types";

// ---------------------------------------------------------------------------
// Minimal fixture builders
// ---------------------------------------------------------------------------

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-default",
    name: "Test Customer",
    phone: "",
    source: "",
    stage: "lead",
    age: 0,
    job: "",
    last: "",
    archived: false,
    ...overrides,
  };
}

function makeEstimate(overrides: Partial<Estimate> = {}): Estimate {
  return {
    id: "est-default",
    num: "EST-1",
    leadId: "lead-default",
    title: "Test estimate",
    status: "sent",
    age: 1,
    viewed: false,
    fu: { on: false, stage: 0 },
    lines: [],
    archived: false,
    trash: false,
    reads: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deriveRail", () => {
  it("includes a sent estimate whose lead is active in out", () => {
    const lead = makeLead({ id: "lead-1", archived: false });
    const est = makeEstimate({ id: "e-1", leadId: "lead-1", status: "sent" });

    const rail = deriveRail([est], [lead], []);
    expect(rail.out.map((r) => r.est.id)).toContain("e-1");
  });

  it("excludes estimates with archived leads from the out rail", () => {
    const activeLead = makeLead({ id: "lead-1", archived: false });
    const archivedLead = makeLead({ id: "lead-2", archived: true });
    const sentActive = makeEstimate({ id: "e-1", leadId: "lead-1", status: "sent" });
    const orphanedSent = makeEstimate({ id: "e-2", leadId: "lead-2", status: "sent" });

    const rail = deriveRail([sentActive, orphanedSent], [activeLead, archivedLead], []);
    expect(rail.out.map((r) => r.est.id)).toEqual(["e-1"]);
    expect(rail.out.map((r) => r.est.id)).not.toContain("e-2");
  });

  it("excludes estimates with archived leads from the won rail", () => {
    const activeLead = makeLead({ id: "lead-1", archived: false });
    const archivedLead = makeLead({ id: "lead-2", archived: true });
    const wonActive = makeEstimate({ id: "e-1", leadId: "lead-1", status: "accepted", age: 1 });
    const orphanedWon = makeEstimate({ id: "e-2", leadId: "lead-2", status: "accepted", age: 1 });

    const rail = deriveRail([wonActive, orphanedWon], [activeLead, archivedLead], []);
    expect(rail.won.map((r) => r.est.id)).toContain("e-1");
    expect(rail.won.map((r) => r.est.id)).not.toContain("e-2");
  });

  it("excludes estimates with no matching lead from out and won rails", () => {
    // No leads at all — any estimate is an orphan.
    const est = makeEstimate({ id: "e-ghost", leadId: "lead-missing", status: "sent" });

    const rail = deriveRail([est], [], []);
    expect(rail.out).toHaveLength(0);
  });

  it("draft estimates are NOT filtered for orphaned leads (shop lane intentional)", () => {
    // Orphaned drafts are not displayed to customers, so they stay in shop.
    const archivedLead = makeLead({ id: "lead-arc", archived: true });
    const draft = makeEstimate({ id: "e-draft", leadId: "lead-arc", status: "draft" });

    const rail = deriveRail([draft], [archivedLead], []);
    expect(rail.shop.map((r) => r.est.id)).toContain("e-draft");
  });

  it("already-archived estimates are excluded from all lanes regardless", () => {
    const lead = makeLead({ id: "lead-1", archived: false });
    const archivedEst = makeEstimate({ id: "e-del", leadId: "lead-1", status: "sent", archived: true });

    const rail = deriveRail([archivedEst], [lead], []);
    expect(rail.out).toHaveLength(0);
    expect(rail.shop).toHaveLength(0);
    expect(rail.won).toHaveLength(0);
  });
});
