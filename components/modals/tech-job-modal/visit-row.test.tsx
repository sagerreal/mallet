// @vitest-environment jsdom
/**
 * One stop inside the visits slot: the stepper (named for a screen reader when the job has more
 * than one stop) and ↩ Reopen on a finished visit. The date lines this file used to assert moved
 * to the pager — see visit-meta.test.ts, which owns every sentence the pager can print.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { VisitRow } from "./visit-row";
import type { Visit } from "@/lib/store/types";

const visit = (over: Partial<Visit> = {}): Visit =>
  ({
    id: "v1",
    date: "2026-07-12",
    techId: "tech-1",
    start: 11,
    dur: 0.5,
    status: "scheduled",
    ...over,
  }) as Visit;

const row = (v: Visit, opts: { seq?: { n: number; of: number }; canReopen?: boolean } = {}) =>
  render(
    <VisitRow
      visit={v}
      seq={opts.seq}
      canReopen={opts.canReopen ?? false}
      canStep={false}
      onStatus={vi.fn()}
    />,
  );

describe("VisitRow — the stepper is the record", () => {
  it("renders the stepper as a readout when the viewer may not step", () => {
    row(visit());
    expect(screen.getByRole("list", { name: "Visit progress" })).toBeTruthy();
    // A readout has no live nodes — nothing here is a button.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("carries the stop number in the stepper's accessible name on a multi-stop job", () => {
    row(visit(), { seq: { n: 2, of: 2 } });
    expect(screen.getByRole("list", { name: "Visit 2 progress" })).toBeTruthy();
  });
});

describe("VisitRow — ↩ Reopen", () => {
  it("offers it to the office on a finished stop", () => {
    row(visit({ status: "done" }), { canReopen: true });
    expect(screen.getByText("↩ Reopen")).toBeTruthy();
  });

  it("never offers it on a stop that has not finished", () => {
    row(visit(), { canReopen: true });
    expect(screen.queryByText("↩ Reopen")).toBeNull();
  });

  it("never offers it to the field — a visit status rewrite has no field endpoint", () => {
    row(visit({ status: "done" }), { canReopen: false });
    expect(screen.queryByText("↩ Reopen")).toBeNull();
  });
});
