import { describe, it, expect } from "vitest";
import { csvField, tsRowsToCsv, tsCsvFilename } from "./timesheet-grid-export";
import type { TsCrewRow } from "./timesheet-grid-derive";

const WEEK = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16"];

const row = (over: Partial<TsCrewRow> = {}): TsCrewRow => ({
  techId: "t1",
  name: "Carlos Rivas",
  initials: "CR",
  dayHours: [8, 8.5, null, 8, 8, null, null],
  otDays: new Set<number>([1]),
  paid: 32.5,
  ot: 0.5,
  issues: 0,
  status: "review",
  ...over,
});

describe("csvField", () => {
  it("quotes a comma so the columns after it do not shift", () => {
    // A shifted column in a payroll file pays somebody another man's hours.
    expect(csvField("Rivas, Carlos")).toBe('"Rivas, Carlos"');
  });

  it("doubles an inner quote", () => {
    expect(csvField('Dave "Junior" Chen')).toBe('"Dave ""Junior"" Chen"');
  });

  it("quotes a newline rather than ending the record early", () => {
    expect(csvField("line one\nline two")).toBe('"line one\nline two"');
  });

  it("leaves an ordinary value alone", () => {
    expect(csvField("Carlos Rivas")).toBe("Carlos Rivas");
    expect(csvField(8.5)).toBe("8.5");
  });

  it("renders null as empty, never the word null", () => {
    expect(csvField(null)).toBe("");
  });
});

describe("tsRowsToCsv", () => {
  it("dates the day columns — a file read later has to say which week", () => {
    const csv = tsRowsToCsv([row()], WEEK);
    const head = csv.split("\r\n")[0] ?? "";
    expect(head.startsWith("Technician,")).toBe(true);
    expect(head).toContain("2026-08-10"); // the weekday alone would not say which week
    expect(head).toContain("Regular,Overtime,Total,Issues,Status");
  });

  it("exports an unreported day as EMPTY, not zero", () => {
    // Zero claims somebody worked no hours. Empty is the absence of a claim, and payroll reads
    // those differently.
    const cells = (tsRowsToCsv([row()], WEEK).split("\r\n")[1] ?? "").split(",");
    expect(cells[1]).toBe("8.00");
    expect(cells[3]).toBe(""); // Wednesday — nothing reported
  });

  it("reports regular UNCAPPED, matching the grid and the technician's own screen", () => {
    const cells = (tsRowsToCsv([row({ paid: 46, ot: 6 })], WEEK).split("\r\n")[1] ?? "").split(",");
    expect(cells[8]).toBe("40.00"); // 46 paid − 6 OT
    expect(cells[9]).toBe("6.00");
    expect(cells[10]).toBe("46.00");
  });

  it("leaves the issue column blank at zero rather than printing 0", () => {
    const cells = (tsRowsToCsv([row({ issues: 0 })], WEEK).split("\r\n")[1] ?? "").split(",");
    expect(cells[11]).toBe("");
  });

  it("names each status in words payroll can read", () => {
    const csv = tsRowsToCsv([row({ status: "empty" })], WEEK);
    expect(csv).toContain("Nothing reported");
  });

  it("exports exactly the rows it is given — a filtered grid exports the filtered set", () => {
    const csv = tsRowsToCsv([row(), row({ techId: "t2", name: "Dwayne Ellis" })], WEEK);
    expect(csv.split("\r\n")).toHaveLength(3); // header + 2
  });

  it("survives a name that would otherwise break the file", () => {
    const csv = tsRowsToCsv([row({ name: 'Rivas, Carlos "CR"' })], WEEK);
    expect(csv).toContain('"Rivas, Carlos ""CR"""');
    expect(csv.split("\r\n")).toHaveLength(2);
  });
});

describe("tsCsvFilename", () => {
  it("names the week it covers, in a form that sorts", () => {
    expect(tsCsvFilename("2026-08-10")).toBe("timesheets-2026-08-10.csv");
  });
});
