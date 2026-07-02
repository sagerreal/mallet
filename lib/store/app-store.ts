/**
 * lib/store/app-store.ts
 * Zustand store — composed from typed slices.
 * Data seeded from lib/prototype-sample; UI state ephemeral.
 */

"use client";

import { create } from "zustand";
import { createUISlice, type UISlice } from "./slices/ui-slice";
import { createLeadsSlice, type LeadsSlice } from "./slices/leads-slice";
import { createDataSlice, type DataSlice } from "./slices/data-slice";

export type AppStore = UISlice & LeadsSlice & DataSlice;

export const useAppStore = create<AppStore>()((...args) => ({
  ...createUISlice(...args),
  ...createLeadsSlice(...args),
  ...createDataSlice(...args),
}));

// Convenience selectors — import these instead of reaching into the store directly
export const useActiveModal = () => useAppStore((s) => s.activeModal);
export const useOpenModal = () => useAppStore((s) => s.openModal);
export const useCloseModal = () => useAppStore((s) => s.closeModal);
export const useLeads = () => useAppStore((s) => s.leads);
export const useTasks = () => useAppStore((s) => s.tasks);
export const useCustSeg = () => useAppStore((s) => s.custSeg);
export const useSetCustSeg = () => useAppStore((s) => s.setCustSeg);
