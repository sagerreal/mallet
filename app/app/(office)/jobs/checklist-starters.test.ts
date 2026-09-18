// TDD: this test drives the shape and content rules for checklist-starters.ts.
// Run first (RED), author the data, run again (GREEN).

import { describe, it, expect } from "vitest";
import { CHECKLIST_STARTERS, checklistStartersFor } from "./checklist-starters";
import { TRADE_PLAYBOOKS } from "../settings/trade-playbooks";

const EXPECTED_TRADE_KEYS = TRADE_PLAYBOOKS.map((t) => t.key);

describe("checklist starter sets", () => {
  it("covers exactly the same trade keys as trade-playbooks, in the same order", () => {
    const keys = CHECKLIST_STARTERS.map((s) => s.key);
    expect(keys).toEqual(EXPECTED_TRADE_KEYS);
  });

  it("every trade has ≥2 checklists", () => {
    for (const set of CHECKLIST_STARTERS) {
      expect(set.checklists.length, `${set.key} needs at least 2 checklists`).toBeGreaterThanOrEqual(2);
    }
  });

  it("every checklist has ≥3 items and ≤50 items", () => {
    for (const set of CHECKLIST_STARTERS) {
      for (const cl of set.checklists) {
        expect(
          cl.items.length,
          `${set.key} / "${cl.name}" must have ≥3 items`,
        ).toBeGreaterThanOrEqual(3);
        expect(
          cl.items.length,
          `${set.key} / "${cl.name}" must have ≤50 items`,
        ).toBeLessThanOrEqual(50);
      }
    }
  });

  it("every item type is 'check' or 'photo'", () => {
    for (const set of CHECKLIST_STARTERS) {
      for (const cl of set.checklists) {
        for (const item of cl.items) {
          expect(
            ["check", "photo"],
            `${set.key} / "${cl.name}" / "${item.text}" has invalid type`,
          ).toContain(item.type);
        }
      }
    }
  });

  it("no $ tokens anywhere in item text (pricing hygiene)", () => {
    for (const set of CHECKLIST_STARTERS) {
      for (const cl of set.checklists) {
        for (const item of cl.items) {
          expect(item.text, `${set.key} / "${cl.name}" — item text must not contain "$"`).not.toMatch(/\$/);
        }
      }
    }
  });

  it("every trade's FIRST (flagship) checklist has ≥1 photo item", () => {
    for (const set of CHECKLIST_STARTERS) {
      const flagship = set.checklists[0];
      expect(flagship, `${set.key} must have at least one checklist`).toBeDefined();
      if (!flagship) continue;
      const photoItems = flagship.items.filter((i) => i.type === "photo");
      expect(
        photoItems.length,
        `${set.key} flagship checklist "${flagship.name}" must have ≥1 photo item`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("checklist names are unique within each trade", () => {
    for (const set of CHECKLIST_STARTERS) {
      const names = set.checklists.map((c) => c.name.toLowerCase());
      expect(
        new Set(names).size,
        `${set.key} has duplicate checklist names`,
      ).toBe(names.length);
    }
  });

  it("item text is unique within each checklist", () => {
    for (const set of CHECKLIST_STARTERS) {
      for (const cl of set.checklists) {
        const texts = cl.items.map((i) => i.text.toLowerCase());
        expect(
          new Set(texts).size,
          `${set.key} / "${cl.name}" has duplicate item text`,
        ).toBe(texts.length);
      }
    }
  });

  it("checklistStartersFor returns the correct set for a known key", () => {
    const hvac = checklistStartersFor("hvac");
    expect(hvac).toBeDefined();
    expect(hvac?.key).toBe("hvac");
    expect(hvac?.label).toBe("HVAC");
  });

  it("checklistStartersFor returns undefined for an unknown key", () => {
    expect(checklistStartersFor("does_not_exist")).toBeUndefined();
  });

  it('"other" trade has ≥2 checklists (generic pair for any business)', () => {
    const other = checklistStartersFor("other");
    expect(other?.checklists.length).toBeGreaterThanOrEqual(2);
  });

  it("every item text is a non-empty trimmed string", () => {
    for (const set of CHECKLIST_STARTERS) {
      for (const cl of set.checklists) {
        for (const item of cl.items) {
          expect(item.text.trim().length, `empty item text in ${set.key} / "${cl.name}"`).toBeGreaterThan(0);
          expect(item.text, "item text should already be trimmed").toBe(item.text.trim());
        }
      }
    }
  });
});
