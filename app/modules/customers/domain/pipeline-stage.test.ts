import { describe, it, expect } from "vitest";
import { asOrgId } from "@mallet/shared/types";
import { PipelineStage, STAGE_NAME_MAX } from "./pipeline-stage";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const base = {
  id: "11111111-1111-1111-1111-111111111111",
  orgId: ORG,
  name: "Adjuster meeting",
  position: 0,
  createdAt: new Date("2026-08-19T00:00:00Z"),
  updatedAt: new Date("2026-08-19T00:00:00Z"),
  deletedAt: null,
};

describe("PipelineStage", () => {
  it("creates a stage and trims the name — nobody means the trailing space", () => {
    const r = PipelineStage.create({ ...base, name: "  Follow-up 2  " });
    expect(r.ok && r.value.props.name).toBe("Follow-up 2");
  });

  it("refuses an empty name — a blank column head labels nothing", () => {
    expect(PipelineStage.create({ ...base, name: "   " }).ok).toBe(false);
  });

  it("caps the name — a column head is a label, not a paragraph", () => {
    expect(PipelineStage.create({ ...base, name: "x".repeat(STAGE_NAME_MAX + 1) }).ok).toBe(false);
    expect(PipelineStage.create({ ...base, name: "x".repeat(STAGE_NAME_MAX) }).ok).toBe(true);
  });

  it("refuses a negative position — order is an index, not an offset", () => {
    expect(PipelineStage.create({ ...base, position: -1 }).ok).toBe(false);
    expect(PipelineStage.create({ ...base, position: 2.5 }).ok).toBe(false);
  });

  it("rename returns a NEW stage and stamps updatedAt — no mutation", () => {
    const stage = PipelineStage.create(base);
    if (!stage.ok) throw new Error("seed failed");
    const later = new Date("2026-08-20T00:00:00Z");
    const r = stage.value.rename("Supplement filed", later);
    expect(r.ok && r.value.props.name).toBe("Supplement filed");
    expect(r.ok && r.value.props.updatedAt).toBe(later);
    expect(stage.value.props.name).toBe("Adjuster meeting");
  });

  it("rename applies the same validation as create", () => {
    const stage = PipelineStage.create(base);
    if (!stage.ok) throw new Error("seed failed");
    expect(stage.value.rename("", new Date()).ok).toBe(false);
  });
});
