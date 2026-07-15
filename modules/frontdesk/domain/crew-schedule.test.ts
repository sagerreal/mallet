import { describe, it, expect } from "vitest";
import { CrewScheduleEntry } from "./crew-schedule";

describe("CrewScheduleEntry.create", () => {
  it("accepts a valid custom window (8→17)", () => {
    const result = CrewScheduleEntry.create({ weekday: 1, openHour: 8, closeHour: 17 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.props).toEqual({ weekday: 1, openHour: 8, closeHour: 17 });
    }
  });

  it("accepts equal hours (0/0 = closed day)", () => {
    const result = CrewScheduleEntry.create({ weekday: 0, openHour: 0, closeHour: 0 });
    expect(result.ok).toBe(true);
  });

  it("accepts equal non-zero hours (10/10)", () => {
    const result = CrewScheduleEntry.create({ weekday: 3, openHour: 10, closeHour: 10 });
    expect(result.ok).toBe(true);
  });

  it("rejects inverted window (17→8) with field 'closeHour'", () => {
    const result = CrewScheduleEntry.create({ weekday: 1, openHour: 17, closeHour: 8 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect((result.error as { field?: string }).field).toBe("closeHour");
    }
  });

  it("rejects weekday 7 with field 'weekday'", () => {
    const result = CrewScheduleEntry.create({ weekday: 7, openHour: 8, closeHour: 17 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect((result.error as { field?: string }).field).toBe("weekday");
    }
  });

  it("rejects weekday -1 with field 'weekday'", () => {
    const result = CrewScheduleEntry.create({ weekday: -1, openHour: 8, closeHour: 17 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect((result.error as { field?: string }).field).toBe("weekday");
    }
  });

  it("rejects non-integer openHour (8.5) with field 'openHour'", () => {
    const result = CrewScheduleEntry.create({ weekday: 1, openHour: 8.5, closeHour: 17 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect((result.error as { field?: string }).field).toBe("openHour");
    }
  });

  it("rejects closeHour 25 with field 'closeHour'", () => {
    const result = CrewScheduleEntry.create({ weekday: 1, openHour: 8, closeHour: 25 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect((result.error as { field?: string }).field).toBe("closeHour");
    }
  });
});
