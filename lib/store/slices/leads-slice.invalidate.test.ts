// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";

/**
 * The store mutation → list refetch path, end to end through a real slice.
 *
 * lib/trpc/list-cache.test.ts proves the bridge invalidates the right KEYS. This proves the wiring
 * on the other side: that a slice mutation actually calls it, and — the part that would be silent
 * if wrong — that it calls it only AFTER the server write resolves. Invalidating alongside the
 * optimistic set starts a refetch that races the commit, and the response, taken before the write
 * landed, renders the row back to its old value. That failure looks exactly like "my edit didn't
 * save", which is the bug this whole mechanism exists to prevent.
 */

const created = {
  id: "lead-1", name: "Zsofia Quennell", phone: null, email: null, source: null,
  stage: "new", value: { cents: 0, currency: "USD" }, unread: false, notes: null, address: null,
  companyId: null, role: null, createdAt: new Date().toISOString(),
};

let resolveCreate: (v: unknown) => void = () => {};
const createMutate = vi.fn(() => new Promise((res) => { resolveCreate = res; }));

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      customers: {
        create: { mutate: (...a: unknown[]) => createMutate(...(a as [])) },
        update: { mutate: vi.fn() },
        archive: { mutate: vi.fn() },
        restore: { mutate: vi.fn() },
      },
      tasks: {
        setDone: { mutate: vi.fn() }, update: { mutate: vi.fn() },
        create: { mutate: vi.fn() }, remove: { mutate: vi.fn() },
      },
    },
  },
}));

import { registerListCache, resetListCache } from "@/lib/trpc/list-cache";
import { useAppStore } from "@/lib/store/app-store";

describe("a store write refreshes the list that renders it", () => {
  let qc: QueryClient;
  let invalidate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    qc = new QueryClient();
    invalidate = vi.spyOn(qc, "invalidateQueries").mockResolvedValue(undefined);
    registerListCache(qc);
    createMutate.mockClear();
  });

  afterEach(() => {
    resetListCache();
    vi.restoreAllMocks();
  });

  it("does NOT refetch while the write is still in flight", async () => {
    const { addLead } = useAppStore.getState();
    addLead({ name: "Zsofia Quennell" } as never);

    // The optimistic row is in the store; the server has not answered yet.
    await Promise.resolve();
    expect(createMutate).toHaveBeenCalled();
    expect(
      invalidate,
      "a refetch started before the commit would return the list WITHOUT this row",
    ).not.toHaveBeenCalled();
  });

  it("refetches the customers list once the server confirms", async () => {
    const { addLead } = useAppStore.getState();
    const { persisted } = addLead({ name: "Zsofia Quennell" } as never);

    resolveCreate(created);
    await persisted.catch(() => {});
    await Promise.resolve();

    const keys = invalidate.mock.calls
      .map((c: unknown[]) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))
      .join(" ");
    expect(keys).toContain("customers");
    expect(keys).toContain("list");
  });
});
