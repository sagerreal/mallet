import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { checklistTemplates, checklistItems } from "./checklists";

describe("checklist_templates schema", () => {
  const cfg = getTableConfig(checklistTemplates);

  it("is named checklist_templates", () => {
    expect(cfg.name).toBe("checklist_templates");
  });

  it("has org_id, name, trade, stage, match, soft-delete, timestamps", () => {
    const cols = new Set(cfg.columns.map((c) => c.name));
    for (const c of ["id", "org_id", "name", "trade", "stage", "match", "created_at", "updated_at", "deleted_at"]) {
      expect(cols.has(c)).toBe(true);
    }
  });

  it("stage defaults to job and match is an array", () => {
    const stage = cfg.columns.find((c) => c.name === "stage");
    expect(stage?.default).toBe("job");
    const match = cfg.columns.find((c) => c.name === "match");
    expect(match?.notNull).toBe(true);
  });

  it("exposes composite unique (org_id, id) for child FK", () => {
    expect(cfg.uniqueConstraints.some((u) => u.name === "checklist_templates_org_id_uq")).toBe(true);
  });
});

describe("checklist_items schema", () => {
  const cfg = getTableConfig(checklistItems);

  it("is named checklist_items", () => {
    expect(cfg.name).toBe("checklist_items");
  });

  it("has template_id, text, type, required, position, soft-delete", () => {
    const cols = new Set(cfg.columns.map((c) => c.name));
    for (const c of ["id", "org_id", "template_id", "text", "type", "required", "position", "deleted_at"]) {
      expect(cols.has(c)).toBe(true);
    }
  });

  it("required defaults false, position defaults 0", () => {
    expect(cfg.columns.find((c) => c.name === "required")?.default).toBe(false);
    expect(cfg.columns.find((c) => c.name === "position")?.default).toBe(0);
  });

  it("has a composite FK to (org_id, template_id)", () => {
    expect(cfg.foreignKeys.some((fk) => fk.getName() === "checklist_items_template_fk")).toBe(true);
  });
});
