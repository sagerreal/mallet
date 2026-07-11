import { describe, it, expect } from "vitest";
import { asChecklistId, asChecklistItemId, asOrgId, isOk } from "@mallet/shared/types";
import { Checklist, ChecklistItem, type ChecklistProps } from "./checklist";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const CHK = asChecklistId("11111111-1111-1111-1111-111111111111");

const baseItem = () =>
  ChecklistItem.create({
    id: asChecklistItemId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    text: "Photo of the finished install",
    type: "photo",
    required: true,
    position: 0,
  });

const baseProps = (over: Partial<ChecklistProps> = {}): ChecklistProps => ({
  id: CHK,
  orgId: ORG,
  name: "Water heater — before you leave",
  trade: "Plumbing",
  stage: "job",
  match: ["water heater"],
  items: [],
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...over,
});

describe("ChecklistItem", () => {
  it("creates a valid item", () => {
    const r = baseItem();
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.text).toBe("Photo of the finished install");
  });

  it("rejects an empty text", () => {
    const r = ChecklistItem.create({
      id: asChecklistItemId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
      text: "   ",
      type: "check",
      required: false,
      position: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("text");
  });

  it("rejects an unknown type", () => {
    const r = ChecklistItem.create({
      id: asChecklistItemId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
      text: "x",
      // @ts-expect-error deliberately invalid
      type: "video",
      required: false,
      position: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("type");
  });
});

describe("Checklist", () => {
  it("creates a valid template and trims the name", () => {
    const r = Checklist.create(baseProps({ name: "  Repipe  " }));
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.name).toBe("Repipe");
  });

  it("rejects an empty name", () => {
    const r = Checklist.create(baseProps({ name: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("name");
  });

  it("rejects an unknown stage", () => {
    // @ts-expect-error deliberately invalid
    const r = Checklist.create(baseProps({ stage: "invoice" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("stage");
  });

  it("withItems returns a new aggregate ordered by position", () => {
    const i0 = baseItem();
    const i1 = ChecklistItem.create({
      id: asChecklistItemId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
      text: "Test T&P valve",
      type: "check",
      required: true,
      position: 1,
    });
    if (!isOk(i0) || !isOk(i1)) throw new Error("item create failed");
    const base = Checklist.create(baseProps());
    if (!isOk(base)) throw new Error("checklist create failed");
    const next = base.value.withItems([i1.value, i0.value], new Date("2026-07-02T00:00:00Z"));
    expect(next.props.items.map((i) => i.props.text)).toEqual([
      "Photo of the finished install",
      "Test T&P valve",
    ]);
    expect(next.props.updatedAt.toISOString()).toBe("2026-07-02T00:00:00.000Z");
  });
});
