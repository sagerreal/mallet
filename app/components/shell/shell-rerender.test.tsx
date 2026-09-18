// @vitest-environment jsdom
/**
 * components/shell/shell-rerender.test.tsx
 * Verifies that the primitive-count selectors used by shell chrome do NOT
 * cause re-renders when an unrelated store slice is written.
 *
 * Strategy: mount a tiny test component that subscribes to each shell selector
 * via a real Zustand store and counts renders.  Write an unrelated key (e.g.
 * `activeModal`) and assert the render count stays at 1.  This is the
 * React-Profiler-equivalent check the plan requires without needing a real
 * browser session.
 */

import { describe, it, expect, vi } from "vitest";
import { render, act, screen } from "@testing-library/react";
import React from "react";
import { create } from "zustand";
import type { Job, Invoice, Lead, Task } from "@/lib/store/types";
import {
  selectOpenTaskCount,
  selectCustomerCount,
  selectJobsCount,
  selectUnscheduledCount,
  selectMoneyCount,
} from "./shell-selectors";

// ---- minimal store mirroring the slices the shell selectors touch -----------
// We use the real store types for the typed slices so the selectors (which are
// typed against Pick<AppStore, ...>) accept the store without casts.

interface TestStore {
  tasks: Task[];
  leads: Lead[];
  jobs: Job[];
  invoices: Invoice[];
  /** Unrelated key — simulates a timesheets/messages/modal write. */
  unrelated: number;
  setUnrelated: (n: number) => void;
  setJobs: (jobs: Job[]) => void;
}

function mkJ(id: string, archived: boolean, status: string): Job {
  return {
    id, leadId: "l1", svc: "plumbing", origin: "office",
    title: "t", addr: "1 Main", phone: "555",
    status, archived,
    lines: [], addons: [], photos: [], notes: "", acts: [], visits: [],
  };
}

function mkI(id: string, archived: boolean, status: string): Invoice {
  return {
    id, num: id, jobId: null, leadId: "l1", cust: "Pat", phone: "555",
    title: "t", lines: [], total: 0, depPaid: 0, payments: [],
    status: status as Invoice["status"], age: 0, archived,
  };
}

function makeStore() {
  return create<TestStore>()((set) => ({
    tasks: [
      { id: "t1", t: "Task 1", due: null, leadId: null, done: false },
      { id: "t2", t: "Task 2", due: null, leadId: null, done: true },
    ],
    leads: [
      { id: "l1", name: "Pat", phone: "555", source: "web", tags: [], stage: "won", age: 0, job: "", last: "", archived: false },
      { id: "l2", name: "Sam", phone: "555", source: "web", tags: [], stage: "won", age: 0, job: "", last: "", archived: true },
    ],
    jobs: [
      mkJ("j1", false, "scheduled"),
      mkJ("j2", false, "unscheduled"),
      mkJ("j3", false, "done"),
    ],
    invoices: [
      mkI("i1", false, "sent"),
      mkI("i2", false, "paid"),
    ],
    unrelated: 0,
    setUnrelated: (n) => set({ unrelated: n }),
    setJobs: (jobs) => set({ jobs }),
  }));
}

// ---- helper: mount a component that subscribes to ONE selector -------------

function mountSelectorProbe<T>(
  store: ReturnType<typeof makeStore>,
  selector: (s: TestStore) => T
): { getCount: () => number } {
  const renderCount = { current: 0 };

  function Probe() {
    renderCount.current += 1;
    store(selector); // subscription
    // Render a marker so act() actually mounts the component.
    return <span data-testid="probe">{renderCount.current}</span>;
  }

  render(<Probe />);

  return { getCount: () => renderCount.current };
}

// ---- tests -----------------------------------------------------------------

describe("shell selector subscriptions — no re-render on unrelated slice write", () => {
  it("selectOpenTaskCount: unrelated write does not re-render", () => {
    const store = makeStore();
    const { getCount } = mountSelectorProbe(store, selectOpenTaskCount);
    expect(getCount()).toBe(1);

    act(() => { store.getState().setUnrelated(99); });
    expect(getCount()).toBe(1); // still 1 — referential equality win
  });

  it("selectCustomerCount: unrelated write does not re-render", () => {
    const store = makeStore();
    const { getCount } = mountSelectorProbe(store, selectCustomerCount);
    expect(getCount()).toBe(1);

    act(() => { store.getState().setUnrelated(42); });
    expect(getCount()).toBe(1);
  });

  it("selectJobsCount: unrelated write does not re-render", () => {
    const store = makeStore();
    const { getCount } = mountSelectorProbe(store, selectJobsCount);
    expect(getCount()).toBe(1);

    act(() => { store.getState().setUnrelated(7); });
    expect(getCount()).toBe(1);
  });

  it("selectUnscheduledCount: unrelated write does not re-render", () => {
    const store = makeStore();
    const { getCount } = mountSelectorProbe(store, selectUnscheduledCount);
    expect(getCount()).toBe(1);

    act(() => { store.getState().setUnrelated(3); });
    expect(getCount()).toBe(1);
  });

  it("selectMoneyCount: unrelated write does not re-render", () => {
    const store = makeStore();
    const { getCount } = mountSelectorProbe(store, selectMoneyCount);
    expect(getCount()).toBe(1);

    act(() => { store.getState().setUnrelated(11); });
    expect(getCount()).toBe(1);
  });

  it("selectJobsCount: a relevant write (jobs slice) DOES re-render", () => {
    const store = makeStore();
    const { getCount } = mountSelectorProbe(store, selectJobsCount);
    expect(getCount()).toBe(1);

    // Add a new active job — count changes from 2→3, re-render expected.
    act(() => {
      store.getState().setJobs([
        mkJ("j1", false, "scheduled"),
        mkJ("j2", false, "unscheduled"),
        mkJ("j3", false, "done"),
        mkJ("j4", false, "scheduled"), // new job → count 2→3
      ]);
    });
    expect(getCount()).toBe(2); // re-rendered exactly once because count changed
  });

  it("selectJobsCount: a jobs slice write with same count does NOT re-render", () => {
    const store = makeStore();
    const { getCount } = mountSelectorProbe(store, selectJobsCount);
    expect(getCount()).toBe(1);

    // Replace jobs array but keep count identical (still 2 active non-done jobs).
    act(() => {
      store.getState().setJobs([
        mkJ("new-j1", false, "scheduled"),
        mkJ("new-j2", false, "unscheduled"),
        mkJ("new-j3", false, "done"), // still doesn't count
      ]);
    });
    // Primitive number returned is still 2 → no re-render.
    expect(getCount()).toBe(1);
  });
});
