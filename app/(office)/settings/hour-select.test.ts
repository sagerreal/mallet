// hour-select.test.ts
import { describe, it, expect } from "vitest";
import { hourLabel } from "./hour-select";
import { seedDayDraft, draftToSaveEntries } from "./crew-hours-card";

describe("hourLabel", () => {
  it("converts 0 to 12:00 AM", () => {
    expect(hourLabel(0)).toBe("12:00 AM");
  });
  it("converts 8 to 8:00 AM", () => {
    expect(hourLabel(8)).toBe("8:00 AM");
  });
  it("converts 12 to 12:00 PM", () => {
    expect(hourLabel(12)).toBe("12:00 PM");
  });
  it("converts 17 to 5:00 PM", () => {
    expect(hourLabel(17)).toBe("5:00 PM");
  });
  it("converts 23 to 11:00 PM", () => {
    expect(hourLabel(23)).toBe("11:00 PM");
  });
  it("converts 24 to Midnight", () => {
    expect(hourLabel(24)).toBe("Midnight");
  });
});

describe("seedDayDraft", () => {
  it("no entry → business mode with default hours", () => {
    expect(seedDayDraft(undefined)).toEqual({ mode: "business", openHour: 8, closeHour: 17 });
  });
  it("entry 0/0 → off mode", () => {
    expect(seedDayDraft({ openHour: 0, closeHour: 0 })).toEqual({ mode: "off", openHour: 0, closeHour: 0 });
  });
  it("entry 8/17 → custom mode with those hours", () => {
    expect(seedDayDraft({ openHour: 8, closeHour: 17 })).toEqual({ mode: "custom", openHour: 8, closeHour: 17 });
  });
});

describe("draftToSaveEntries", () => {
  const WEEKDAYS = [{ label: "Mon", n: 1 }] as const;

  it("business mode → omitted from output", () => {
    const draft = { 1: { mode: "business" as const, openHour: 8, closeHour: 17 } };
    expect(draftToSaveEntries(draft, WEEKDAYS)).toEqual([]);
  });
  it("off mode → included with 0/0", () => {
    const draft = { 1: { mode: "off" as const, openHour: 0, closeHour: 0 } };
    expect(draftToSaveEntries(draft, WEEKDAYS)).toEqual([{ weekday: 1, openHour: 0, closeHour: 0 }]);
  });
  it("custom mode → included with the specified hours", () => {
    const draft = { 1: { mode: "custom" as const, openHour: 8, closeHour: 17 } };
    expect(draftToSaveEntries(draft, WEEKDAYS)).toEqual([{ weekday: 1, openHour: 8, closeHour: 17 }]);
  });
});
