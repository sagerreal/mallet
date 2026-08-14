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
  threads: undefined as ReadonlyArray<{ unreadCount: number }> | undefined,
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
        teamChat: {
          listThreads: {
            useQuery: (_input: unknown, opts?: { enabled?: boolean }) => {
              state.captured.teamChat = opts;
              return { data: state.threads };
            },
          },
        },
      },
    },
  };
});

import { useNavCounts } from "./use-nav-counts";

describe("useNavCounts role gating", () => {
  beforeEach(() => {
    state.role = "owner";
    state.captured = {};
    state.threads = undefined;
  });

  it("disables all three count queries for a tech — they can only FORBIDDEN", () => {
    state.role = "tech";
    const { result } = renderHook(() => useNavCounts());
    expect(state.captured.jobs?.enabled).toBe(false);
    expect(state.captured.customers?.enabled).toBe(false);
    expect(state.captured.money?.enabled).toBe(false);
    // No badge, rather than a wrong one.
    expect(result.current).toEqual({
      jobs: undefined, customers: undefined, money: undefined, messages: undefined,
    });
  });

  it("keeps the queries live for owner/office and returns the database totals", () => {
    const { result } = renderHook(() => useNavCounts());
    expect(state.captured.jobs?.enabled).toBe(true);
    expect(state.captured.customers?.enabled).toBe(true);
    expect(state.captured.money?.enabled).toBe(true);
    expect(result.current).toEqual({ jobs: 7, customers: 7, money: 7, messages: undefined });
  });

  it("fails open while the role is unknown — a slow me query must not blank office badges", () => {
    state.role = undefined;
    renderHook(() => useNavCounts());
    expect(state.captured.jobs?.enabled).toBe(true);
  });
});

/**
 * Messages was the one nav item with no badge, so a tech — whose whole shell is My day, My hours
 * and Messages — had no unread signal anywhere in the app. Team chat is `anyRole`, so unlike the
 * other three counts this query must stay live for a tech.
 */
describe("useNavCounts — unread team messages", () => {
  beforeEach(() => {
    state.role = "owner";
    state.captured = {};
    state.threads = undefined;
  });

  it("sums MY unread across every thread", () => {
    state.threads = [{ unreadCount: 2 }, { unreadCount: 0 }, { unreadCount: 3 }];
    const { result } = renderHook(() => useNavCounts());
    expect(result.current.messages).toBe(5);
  });

  it("stays enabled for a tech — the role the badge exists for", () => {
    state.role = "tech";
    state.threads = [{ unreadCount: 1 }];
    const { result } = renderHook(() => useNavCounts());
    expect(state.captured.teamChat?.enabled).not.toBe(false);
    expect(result.current.messages).toBe(1);
  });

  it("reports undefined, not 0, while the threads are in flight", () => {
    const { result } = renderHook(() => useNavCounts());
    expect(result.current.messages).toBeUndefined();
  });
});
