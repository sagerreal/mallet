// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { mkEntry, mkJob, mkLead, mkTech, mkVisit } from "./test-factories";
import { tsRollup, tsWeekDates, tsDayLabel } from "./timesheet-derive";
import { TsTechWeekCard, type TsTechWeekCardProps } from "./timesheets-crew";
import type { TimeEntry } from "@/lib/store/types";

const WEEK = tsWeekDates("2026-06-29"); // Mon 29 Jun – Sun 5 Jul 2026
const TECH = mkTech({ id: "t1", name: "Mike Rivera" });

function renderCard(over: Partial<TsTechWeekCardProps> = {}) {
  const entries = (over.entries ?? []) as TimeEntry[];
  const props: TsTechWeekCardProps = {
    tech: TECH,
    rollup: tsRollup(entries, TECH.id, WEEK),
    entries,
    jobs: [],
    leads: [mkLead({ id: "l1", name: "Dave Chen" })],
    techs: [TECH],
    weekDates: WEEK,
    editId: null,
    pick: null,
    onSetPick: vi.fn(),
    onEdit: vi.fn(),
    onStop: vi.fn(),
    onDelete: vi.fn(),
    onSetField: vi.fn(),
    onCloseEdit: vi.fn(),
    onAddEntry: vi.fn(),
    onApprove: vi.fn(),
    onReopen: vi.fn(),
    unfinishedDays: null,
    ...over,
  };
  return { ...render(<TsTechWeekCard {...props} />), props };
}

const dayEntry = (over: Partial<TimeEntry>): TimeEntry =>
  mkEntry({ techId: TECH.id, date: "2026-06-29", jobId: null, kind: "shop", ...over });

describe("the week summary", () => {
  it("shows paid, regular and overtime HOURS", () => {
    // 4 × 10h + 1 × 11h = 51h → 40 regular, 11 overtime.
    const entries = WEEK.slice(0, 5).map((d, i) =>
      dayEntry({ id: `e${i}`, date: d, start: "07:00", end: i === 4 ? "18:00" : "17:00" }),
    );
    const { container } = renderCard({ entries });
    const metrics = container.querySelector(".ts-metrics") as HTMLElement;

    expect(within(metrics).getByText("Paid")).toBeTruthy();
    expect(within(metrics).getByText("51.00 h")).toBeTruthy();
    expect(within(metrics).getByText("Regular")).toBeTruthy();
    expect(within(metrics).getByText("40.00 h")).toBeTruthy();
    expect(within(metrics).getByText("Overtime")).toBeTruthy();
    expect(within(metrics).getByText("11.00 h")).toBeTruthy();
  });

  // Settled product decision: HOURS only — payroll owns the wage. Mallet does not store, compute or
  // display what anyone is paid, and this card is the likeliest place for money to creep back in.
  it("shows no money anywhere — no wage, no gross pay, no rate", () => {
    const entries = [dayEntry({ id: "e1", start: "08:00", end: "16:00" })];
    const { container } = renderCard({ entries });
    const text = container.textContent ?? "";

    expect(text).not.toContain("$");
    expect(text.toLowerCase()).not.toContain("pay");
    expect(text.toLowerCase()).not.toContain("wage");
    expect(text.toLowerCase()).not.toContain("rate");
  });
});

describe("a refused approval", () => {
  it("names the days that are still on the clock and what to do about them", () => {
    const entries = [
      dayEntry({ id: "e1", date: "2026-06-30", start: "08:00", end: null, running: true }),
      dayEntry({ id: "e2", date: "2026-07-02", start: "08:00", end: null }),
    ];
    renderCard({ entries, unfinishedDays: ["2026-06-30", "2026-07-02"] });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(tsDayLabel("2026-06-30"));
    expect(alert.textContent).toContain(tsDayLabel("2026-07-02"));
    expect(alert.textContent).toContain("Stop each one below");
  });

  it("says nothing when nothing was refused", () => {
    renderCard({ entries: [dayEntry({ id: "e1" })], unfinishedDays: [] });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("marks the offending day in the grid, so the message points somewhere", () => {
    const entries = [dayEntry({ id: "e1", date: "2026-06-30", start: "08:00", end: null, running: true })];
    const { container } = renderCard({ entries, unfinishedDays: ["2026-06-30"] });
    const headers = Array.from(container.querySelectorAll(".ts-dhdr")).map((h) => h.textContent ?? "");

    expect(headers.some((h) => h.includes("needs an end time"))).toBe(true);
  });
});

describe("a running entry", () => {
  const running = dayEntry({ id: "e-live", start: "08:00", end: null, running: true });

  it("can be stopped from the office grid", () => {
    const { props } = renderCard({ entries: [running] });

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(props.onStop).toHaveBeenCalledWith("e-live");
  });

  it("can still be deleted", () => {
    const { props } = renderCard({ entries: [running] });

    fireEvent.click(screen.getByTitle("Delete entry"));

    expect(props.onDelete).toHaveBeenCalledWith("e-live");
  });

  it("offers no Stop on an approved entry — approved means locked", () => {
    renderCard({ entries: [dayEntry({ id: "e1", status: "approved", start: "08:00", end: "16:00" })] });

    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(screen.queryByTitle("Delete entry")).toBeNull();
  });
});

describe("a day with jobs but no hours", () => {
  const jobs = [
    mkJob({
      id: "j1",
      title: "Water heater swap",
      visits: [mkVisit({ id: "v1", date: "2026-06-30", techId: TECH.id })],
    }),
  ];

  it("says so rather than leaving the day out", () => {
    renderCard({ entries: [], jobs });

    expect(screen.getByText("No hours recorded")).toBeTruthy();
    expect(screen.getByText(tsDayLabel("2026-06-30", "long"))).toBeTruthy();
  });

  it("stays quiet on a day that has hours on it", () => {
    renderCard({ entries: [dayEntry({ id: "e1", date: "2026-06-30", start: "08:00", end: "16:00" })], jobs });

    expect(screen.queryByText("No hours recorded")).toBeNull();
  });

  it("stays quiet on a day the crew was not scheduled at all", () => {
    renderCard({ entries: [], jobs: [mkJob({ id: "j2", visits: [mkVisit({ id: "v2", date: "2026-06-30", techId: "someone-else" })] })] });

    expect(screen.queryByText("No hours recorded")).toBeNull();
    expect(screen.getByText("No entries this week.")).toBeTruthy();
  });
});
