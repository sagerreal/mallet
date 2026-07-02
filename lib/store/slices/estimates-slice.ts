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

export interface EstimatesSlice {
  estimates: Estimate[];
  updateEstimate: (id: number, patch: Partial<Estimate>) => void;
  deleteEstimate: (id: number) => void;
}

export const createEstimatesSlice: StateCreator<EstimatesSlice, [], [], EstimatesSlice> = (set) => ({
  estimates: SEED_ESTIMATES,

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
