/**
 * The customer's copy, grouped under the headings the shop wrote.
 *
 * What matters here is that the customer sees everything they are being charged for. A missing
 * or empty heading must never take a line down with it.
 */
import { describe, it, expect } from "vitest";
import {
  asOrgId,
  asLeadId,
  asEstimateId,
  asEstimateLineId,
  asEstimateSectionId,
  money,
  zeroMoney,
} from "@mallet/shared/types";
import { Estimate, EstimateLine, type EstimateProps } from "@/modules/quoting/domain/estimate";
import { EstimateSection } from "@/modules/quoting/domain/estimate-section";
import { groupBySection } from "./section-groups";

const section = (id: string, name: string, position: number) => {
  const r = EstimateSection.create({ id: asEstimateSectionId(id), name, position });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

const line = (id: string, description: string, rateCents: number, sectionId: string | null, position = 0) => {
  const r = EstimateLine.create({
    id: asEstimateLineId(id),
    description,
    quantity: 1,
    rate: money(rateCents),
    cost: zeroMoney,
    isOptional: false,
    needsPhoto: false,
    position,
    tier: null,
    materialId: null,
    sectionId,
  });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

const estimateOf = (
  lines: EstimateLine[],
  sections: EstimateSection[],
): Estimate => {
  const now = new Date("2026-07-01T00:00:00Z");
  const props: EstimateProps = {
    id: asEstimateId("00000000-0000-0000-0000-00000000e572"),
    orgId: asOrgId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    num: "EST-7002",
    leadId: asLeadId("11111111-1111-1111-1111-111111111111"),
    title: "Grouped",
    status: "sent",
    discBps: 0,
    taxBps: 0,
    depBps: 0,
    depPaid: zeroMoney,
    validDays: null,
    sentAt: now,
    acceptedAt: null,
    declinedAt: null,
    declineReason: null,
    changeRequestedAt: null,
    changeOrderForJobId: null,
    jobId: null,
    changeRequest: null,
    publicToken: "d".repeat(64),
    recommendedTier: null,
    acceptedTier: null,
    tierNames: null,
    termsSnapshot: null,
    lines,
    sections,
    createdAt: now,
    updatedAt: now,
  };
  const r = Estimate.create(props);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

const INTERIOR = "11111111-1111-4111-8111-111111111111";
const EXTERIOR = "22222222-2222-4222-8222-222222222222";

describe("groupBySection", () => {
  it("puts the ungrouped work above the headings and each line under its own", () => {
    const lines = [
      line("l-1", "Trip charge", 9_500, null, 0),
      line("l-2", "Repaint walls", 180_000, INTERIOR, 1),
      line("l-3", "Reseal deck", 90_000, EXTERIOR, 2),
    ];
    const grouped = groupBySection(
      estimateOf(lines, [section(INTERIOR, "Interior", 0), section(EXTERIOR, "Exterior", 1)]),
      lines,
    );
    expect(grouped.ungrouped.map((l) => l.props.description)).toEqual(["Trip charge"]);
    expect(grouped.groups.map((g) => g.name)).toEqual(["Interior", "Exterior"]);
    expect(grouped.groups[0]?.lines.map((l) => l.props.description)).toEqual(["Repaint walls"]);
  });

  it("carries what the work under each heading comes to", () => {
    const lines = [line("l-1", "Repaint walls", 180_000, INTERIOR), line("l-2", "Doors", 40_000, INTERIOR, 1)];
    const grouped = groupBySection(estimateOf(lines, [section(INTERIOR, "Interior", 0)]), lines);
    expect(grouped.groups[0]?.totalCents).toBe(220_000);
  });

  it("does not render a heading with nothing under it", () => {
    // An empty band explains nothing to the person reading the quote.
    const lines = [line("l-1", "Repaint walls", 180_000, INTERIOR)];
    const grouped = groupBySection(
      estimateOf(lines, [section(INTERIOR, "Interior", 0), section(EXTERIOR, "Exterior", 1)]),
      lines,
    );
    expect(grouped.groups.map((g) => g.name)).toEqual(["Interior"]);
  });

  it("shows a line whose heading is not in the list rather than dropping it", () => {
    // The customer must see everything they are being charged for, even if the grouping breaks.
    // Passing a narrower line set than the estimate carries is exactly what the page does when
    // it hands over only the non-optional lines.
    const all = [line("l-1", "Repaint walls", 180_000, INTERIOR), line("l-2", "Trip charge", 9_500, null, 1)];
    const grouped = groupBySection(estimateOf(all, [section(INTERIOR, "Interior", 0)]), [all[1]!]);
    expect(grouped.ungrouped.map((l) => l.props.description)).toEqual(["Trip charge"]);
    expect(grouped.groups).toEqual([]);
  });

  it("puts every line above the fold on an ungrouped quote", () => {
    const lines = [line("l-1", "Repaint walls", 180_000, null)];
    const grouped = groupBySection(estimateOf(lines, []), lines);
    expect(grouped.ungrouped).toHaveLength(1);
    expect(grouped.groups).toEqual([]);
  });
});
