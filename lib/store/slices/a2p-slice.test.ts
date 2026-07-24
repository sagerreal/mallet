/**
 * lib/store/slices/a2p-slice.test.ts
 * a2p-slice holds the read-only A2P registration status view (no mutating actions —
 * A2pHydrator is the only writer, via setA2pStatus). Standalone vanilla-store test,
 * same shape as checklists-slice.test.ts; no trpc mock needed since this slice never
 * calls trpcVanilla itself.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";
import { createA2pSlice, type A2pSlice } from "./a2p-slice";
import type { A2pStatusView } from "@mallet/a2p";

const STATUS_VIEW: A2pStatusView = {
  status: "active",
  canText: true,
  needsInput: false,
  failureReason: null,
};

describe("a2pSlice", () => {
  let store: StoreApi<A2pSlice>;

  beforeEach(() => {
    store = createStore<A2pSlice>((set, get, api) => createA2pSlice(set, get, api));
  });

  it("defaults a2pStatus to null", () => {
    expect(store.getState().a2pStatus).toBeNull();
  });

  it("setA2pStatus sets the status view", () => {
    store.getState().setA2pStatus(STATUS_VIEW);
    expect(store.getState().a2pStatus).toEqual(STATUS_VIEW);
  });

  it("setA2pStatus replaces a prior view rather than merging", () => {
    store.getState().setA2pStatus(STATUS_VIEW);
    const next: A2pStatusView = {
      status: "failed",
      canText: false,
      needsInput: true,
      failureReason: "brand rejected",
    };
    store.getState().setA2pStatus(next);
    expect(store.getState().a2pStatus).toEqual(next);
  });
});
