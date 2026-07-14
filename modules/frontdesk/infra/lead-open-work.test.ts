import { describe, it, expect } from "vitest";
import { formatOpenWork, type OpenWorkRow } from "./lead-open-work";

const row = (o: Partial<OpenWorkRow> = {}): OpenWorkRow => ({
  jobNum: "142",
  jobStatus: "scheduled",
  scheduledStart: new Date("2026-07-16T15:00:00Z"),
  jobLabel: "drain clear",
  ...o,
});

describe("formatOpenWork", () => {
  it("renders the full line: number, status, short date, label", () => {
    expect(formatOpenWork(row())).toBe("job #142 scheduled Jul 16 (drain clear)");
  });

  it("returns null when there is no active job (no jobNum)", () => {
    expect(formatOpenWork(row({ jobNum: null }))).toBeNull();
  });

  it("omits the label parens when there is no label", () => {
    expect(formatOpenWork(row({ jobLabel: null }))).toBe("job #142 scheduled Jul 16");
  });

  it("trims a blank label to nothing", () => {
    expect(formatOpenWork(row({ jobLabel: "   " }))).toBe("job #142 scheduled Jul 16");
  });

  it("omits the date when unscheduled", () => {
    expect(formatOpenWork(row({ scheduledStart: null }))).toBe("job #142 scheduled (drain clear)");
  });

  it("renders a bare job number when status and date are absent", () => {
    expect(formatOpenWork(row({ jobStatus: null, scheduledStart: null, jobLabel: null }))).toBe(
      "job #142",
    );
  });
});
