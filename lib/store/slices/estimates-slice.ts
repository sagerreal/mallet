/**
 * lib/store/slices/estimates-slice.ts
 * Estimate/quote data + mutations (seeded from sample). Immutable updates only.
 * Cross-entity effects (e.g. moving the lead stage on send) live in the caller
 * so this slice stays decoupled from the leads slice.
 */

import type { StateCreator } from "zustand";
import type { Estimate } from "../types";
import { SAMPLE_ESTIMATES } from "@/lib/prototype-sample";

const SEED_ESTIMATES: Estimate[] = SAMPLE_ESTIMATES.map((e) => ({ ...e }));

// Continue the sample's Q-numbers (sample tops out at Q-1044).
let _nextEstId = 200;
let _nextEstNum = 1045;

export interface EstimatesSlice {
  estimates: Estimate[];
  addEstimate: (draft: Omit<Estimate, "id" | "num">) => Estimate;
  updateEstimate: (id: number, patch: Partial<Estimate>) => void;
  deleteEstimate: (id: number) => void;
}

export const createEstimatesSlice: StateCreator<EstimatesSlice, [], [], EstimatesSlice> = (set) => ({
  estimates: SEED_ESTIMATES,

  addEstimate: (draft) => {
    const newEst: Estimate = { ...draft, id: ++_nextEstId, num: `Q-${_nextEstNum++}` };
    set((s) => ({ estimates: [newEst, ...s.estimates] }));
    return newEst;
  },

  updateEstimate: (id, patch) =>
    set((s) => ({
      estimates: s.estimates.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    })),

  deleteEstimate: (id) =>
    set((s) => ({
      estimates: s.estimates.map((e) =>
        e.id === id ? { ...e, archived: true, trash: true } : e
      ),
    })),
});
