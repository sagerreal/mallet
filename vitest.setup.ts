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
}));
