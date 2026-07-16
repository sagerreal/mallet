import { describe, it, expect } from "vitest";
import { withItemRequired } from "./callback-autopsy-card";
import type { ChecklistItem } from "@/lib/store/types";

// Minimal factory for ChecklistItem.
function mkItem(overrides: Partial<ChecklistItem> & { text: string }): ChecklistItem {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    text: overrides.text,
    type: overrides.type ?? "check",
    required: overrides.required ?? false,
    position: overrides.position ?? 0,
  };
}

describe("withItemRequired", () => {
  it("sets the target item to required: true", () => {
    const items = [
      mkItem({ text: "Check pressure" }),
      mkItem({ text: "Take a photo" }),
    ];
    const result = withItemRequired(items, "Check pressure");
    expect(result[0]!.required).toBe(true);
  });

  it("leaves non-target items with their original required value", () => {
    const items = [
      mkItem({ text: "Check pressure", required: false }),
      mkItem({ text: "Take a photo", required: false }),
      mkItem({ text: "Sign off", required: true }),
    ];
    const result = withItemRequired(items, "Check pressure");
    expect(result[1]!.required).toBe(false);
    expect(result[2]!.required).toBe(true);
  });

  it("keeps an already-required target item as required", () => {
    const items = [
      mkItem({ text: "Flush sediment filter", required: true }),
      mkItem({ text: "Take photos", required: false }),
    ];
    const result = withItemRequired(items, "Flush sediment filter");
    expect(result[0]!.required).toBe(true);
    expect(result[1]!.required).toBe(false);
  });

  it("returns items unchanged when no item matches the text", () => {
    const items = [
      mkItem({ text: "Check valve", required: false }),
      mkItem({ text: "Log hours", required: true }),
    ];
    const result = withItemRequired(items, "Non-existent step");
    expect(result[0]!.required).toBe(false);
    expect(result[1]!.required).toBe(true);
  });

  it("matches case-insensitively and trims whitespace", () => {
    const items = [mkItem({ text: "  Check Pressure  ", required: false })];
    const result = withItemRequired(items, "check pressure");
    expect(result[0]!.required).toBe(true);
  });

  it("preserves text and type on every output item", () => {
    const items = [
      mkItem({ text: "Take photo", type: "photo", required: false }),
      mkItem({ text: "Verify seal", type: "check", required: false }),
    ];
    const result = withItemRequired(items, "Take photo");
    expect(result[0]!.text).toBe("Take photo");
    expect(result[0]!.type).toBe("photo");
    expect(result[1]!.text).toBe("Verify seal");
    expect(result[1]!.type).toBe("check");
  });
});
