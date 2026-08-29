/**
 * Sections group lines on an estimate. They carry no money, so what is worth testing is the
 * only thing they can get wrong: an unusable heading, or an order that is not stable.
 */
import { describe, it, expect } from "vitest";
import { EstimateSection, orderSections, MAX_SECTION_NAME_CHARS } from "./estimate-section";
import type { EstimateSectionId, EstimateLineId, EstimateId, OrgId, LeadId } from "@mallet/shared/types";
import { money } from "@mallet/shared/types";
import { Estimate, EstimateLine, type EstimateProps } from "./estimate";

const id = (v: string) => v as EstimateSectionId;

const built = (name: string, position = 0) => {
  const r = EstimateSection.create({ id: id(`s-${name}-${position}`), name, position });
  if (!r.ok) throw new Error(`expected a section, got ${r.error.message}`);
  return r.value;
};

const failure = (props: { name: string; position: number }) => {
  const r = EstimateSection.create({ id: id("s-1"), ...props });
  if (r.ok) throw new Error("expected a validation error");
  return r.error;
};

describe("EstimateSection", () => {
  it("keeps a trimmed name and its position", () => {
    const section = built("  Interior  ", 2);
    expect(section.props.name).toBe("Interior");
    expect(section.props.position).toBe(2);
  });

  it("refuses a blank name — an untitled group is not a group", () => {
    expect(failure({ name: "   ", position: 0 }).field).toBe("name");
  });

  it("refuses a name longer than the column holds", () => {
    expect(failure({ name: "x".repeat(MAX_SECTION_NAME_CHARS + 1), position: 0 }).field).toBe("name");
  });

  it("refuses a fractional or negative position", () => {
    expect(failure({ name: "Interior", position: 1.5 }).field).toBe("position");
    expect(failure({ name: "Interior", position: -1 }).field).toBe("position");
  });

  it("renames and moves without mutating the original", () => {
    const section = built("Interior", 0);
    const renamed = section.renamed("Exterior");
    const moved = section.movedTo(3);
    expect(renamed.ok && renamed.value.props.name).toBe("Exterior");
    expect(moved.ok && moved.value.props.position).toBe(3);
    expect(section.props.name).toBe("Interior");
    expect(section.props.position).toBe(0);
  });

  it("validates a rename the same way as the first name", () => {
    expect(built("Interior").renamed("  ").ok).toBe(false);
  });
});

describe("orderSections", () => {
  it("orders by position", () => {
    const ordered = orderSections([built("Exterior", 1), built("Interior", 0)]);
    expect(ordered.map((s) => s.props.name)).toEqual(["Interior", "Exterior"]);
  });

  it("breaks a tie by name so the order is stable, never arbitrary", () => {
    const ordered = orderSections([built("Windows", 0), built("Doors", 0)]);
    expect(ordered.map((s) => s.props.name)).toEqual(["Doors", "Windows"]);
  });

  it("does not mutate the array it was given", () => {
    const input = [built("Exterior", 1), built("Interior", 0)];
    orderSections(input);
    expect(input.map((s) => s.props.name)).toEqual(["Exterior", "Interior"]);
  });
});

// ---------------------------------------------------------------------------
// The aggregate's side of sections: referential integrity and grouped reads.
// ---------------------------------------------------------------------------

describe("Estimate — sections on the aggregate", () => {
  const sectionId = (v: string) => v as EstimateSectionId;

  const section = (name: string, position: number, at: string) => {
    const r = EstimateSection.create({ id: sectionId(at), name, position });
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };

  const line = (description: string, position: number, at: string | null) => {
    const r = EstimateLine.create({
      id: `l-${description}` as EstimateLineId,
      description,
      quantity: 1,
      rate: money(10_000),
      cost: money(0),
      isOptional: false,
      needsPhoto: false,
      position,
      tier: null,
      materialId: null,
      sectionId: at,
    });
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };

  const estimate = (over: Partial<EstimateProps> = {}) =>
    Estimate.create({
      id: "e-1" as EstimateId,
      orgId: "o-1" as OrgId,
      num: "Q-1",
      leadId: "lead-1" as LeadId,
      title: null,
      status: "draft",
      discBps: 0,
      taxBps: 0,
      depBps: 0,
      depPaid: money(0),
      validDays: null,
      sentAt: null,
      acceptedAt: null,
      declinedAt: null,
      declineReason: null,
      changeRequestedAt: null,
      changeOrderForJobId: null,
      jobId: null,
      changeRequest: null,
      publicToken: null,
      recommendedTier: null,
      acceptedTier: null,
      tierNames: null,
      termsSnapshot: null,
      lines: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    });

  it("refuses a line that points at a section the estimate does not have", () => {
    // Without this the line renders under a heading that is not there — it disappears from the
    // customer's copy without anything failing.
    const r = estimate({ lines: [line("Walls", 0, "s-missing")] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.field).toBe("sectionId");
  });

  it("refuses two sections with the same id", () => {
    const r = estimate({ sections: [section("Interior", 0, "s-1"), section("Exterior", 1, "s-1")] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.field).toBe("sections");
  });

  it("accepts an ungrouped estimate — the historical default", () => {
    expect(estimate({ lines: [line("Walls", 0, null)] }).ok).toBe(true);
  });

  it("reads its sections in render order and the lines under each", () => {
    const r = estimate({
      sections: [section("Exterior", 1, "s-2"), section("Interior", 0, "s-1")],
      lines: [line("Siding", 1, "s-2"), line("Walls", 0, "s-1"), line("Trip charge", 2, null)],
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.sections.map((s) => s.props.name)).toEqual(["Interior", "Exterior"]);
    expect(r.value.linesInSection(sectionId("s-1")).map((l) => l.props.description)).toEqual(["Walls"]);
    // null is a real answer, not "no section given": it is where an ungrouped line lives.
    expect(r.value.linesInSection(null).map((l) => l.props.description)).toEqual(["Trip charge"]);
  });
});
