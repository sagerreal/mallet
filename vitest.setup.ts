import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

vi.mock("@/lib/clock", () => ({
  todayISO: () => "2026-07-01",
  addDaysISO: (iso: string, n: number) => {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  },
  daysFromTodayISO: (n: number) => {
    const d = new Date("2026-07-01T12:00:00");
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  },
  // Measured against the same pinned "today" as the rest of this mock, so an age asserted in a
  // fixture stays the same number forever.
  daysSince: (iso: string) => {
    const then = new Date(iso);
    if (Number.isNaN(then.getTime())) return 0;
    const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = startOf(new Date("2026-07-01T12:00:00")) - startOf(then);
    return Math.max(0, Math.round(diff / 86_400_000));
  },
}));
