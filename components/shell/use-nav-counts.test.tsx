// @vitest-environment jsdom
/**
 * components/shell/use-nav-counts.test.tsx
 *
 * The nav badges are counted by three ownerOrOffice procedures, but the shells mount this hook
 * for EVERY role — a tech's device used to fire all three on every mount and window focus, and
 * each could only come back FORBIDDEN (×2 with retry). These tests pin the gate: tech → all
 * three disabled; office/owner (and role-not-yet-known) → enabled, badges as before.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const state = vi.hoisted(() => ({
  role: "owner" as string | undefined,
  captured: {} as Record<string, { enabled?: boolean } | undefined>,
}));

vi.mock("@/features/identity/hooks", () => ({
  useMe: () => ({ isLoading: false, data: state.role ? { role: state.role } : undefined }),
}));

vi.mock("@/lib/trpc/client", () => {
  const countQuery = (name: string) => ({
    useQuery: (_input: unknown, opts?: { enabled?: boolean }) => {
      state.captured[name] = opts;
      return { data: opts?.enabled === false ? undefined : { total: 7 } };
    },
  });
  return {
    api: {
      v1: {
        jobs: { count: countQuery("jobs") },
        customers: { count: countQuery("customers") },
        invoicing: { count: countQuery("money") },
      },
    },
  };
});

import { useNavCounts } from "./use-nav-counts";

describe("useNavCounts role gating", () => {
  beforeEach(() => {
    state.role = "owner";
    state.captured = {};
  });

  it("disables all three count queries for a tech — they can only FORBIDDEN", () => {
    state.role = "tech";
    const { result } = renderHook(() => useNavCounts());
    expect(state.captured.jobs?.enabled).toBe(false);
    expect(state.captured.customers?.enabled).toBe(false);
    expect(state.captured.money?.enabled).toBe(false);
    // No badge, rather than a wrong one.
    expect(result.current).toEqual({ jobs: undefined, customers: undefined, money: undefined });
  });

  it("keeps the queries live for owner/office and returns the database totals", () => {
    const { result } = renderHook(() => useNavCounts());
    expect(state.captured.jobs?.enabled).toBe(true);
    expect(state.captured.customers?.enabled).toBe(true);
    expect(state.captured.money?.enabled).toBe(true);
    expect(result.current).toEqual({ jobs: 7, customers: 7, money: 7 });
  });

  it("fails open while the role is unknown — a slow me query must not blank office badges", () => {
    state.role = undefined;
    renderHook(() => useNavCounts());
    expect(state.captured.jobs?.enabled).toBe(true);
  });
});
