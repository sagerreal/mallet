/**
 * lib/store/app-store.ts
 * Zustand store — composed from typed slices. Lead data populated at runtime
 * by LeadsHydrator (tRPC); other domains still use prototype sample data.
 */

"use client";

import { create } from "zustand";
import { createUISlice, type UISlice } from "./slices/ui-slice";
import { createLeadsSlice, type LeadsSlice } from "./slices/leads-slice";
import { createDataSlice, type DataSlice } from "./slices/data-slice";
import { createEstimatesSlice, type EstimatesSlice } from "./slices/estimates-slice";
import { createJobsSlice, type JobsSlice } from "./slices/jobs-slice";
import { createInvoicesSlice, type InvoicesSlice } from "./slices/invoices-slice";
import { createCallSlice, type CallSlice } from "./slices/call-slice";
import { createTimesheetsSlice, type TimesheetsSlice } from "./slices/timesheets-slice";
import { createChecklistsSlice, type ChecklistsSlice } from "./slices/checklists-slice";
import { createSettingsSlice, type SettingsSlice } from "./slices/settings-slice";
import { createPricebookSlice, type PricebookSlice } from "./slices/pricebook-slice";
import { createA2pSlice, type A2pSlice } from "./slices/a2p-slice";

export type AppStore = UISlice &
  LeadsSlice &
  DataSlice &
  EstimatesSlice &
  JobsSlice &
  InvoicesSlice &
  CallSlice &
  TimesheetsSlice &
  ChecklistsSlice &
  SettingsSlice &
  PricebookSlice &
  A2pSlice;

export const useAppStore = create<AppStore>()((...args) => ({
  ...createUISlice(...args),
  ...createLeadsSlice(...args),
  ...createDataSlice(...args),
  ...createEstimatesSlice(...args),
  ...createJobsSlice(...args),
  ...createInvoicesSlice(...args),
  ...createCallSlice(...args),
  ...createTimesheetsSlice(...args),
  ...createChecklistsSlice(...args),
  ...createSettingsSlice(...args),
  ...createPricebookSlice(...args),
  ...createA2pSlice(...args),
}));

// Dev/test-only handle so the E2E visual harness can open any store-driven modal
// (and read seeded record ids) deterministically, without depending on fragile UI
// click paths. NEVER exposed in production. See e2e/visual-modals.spec.ts.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __appStore?: typeof useAppStore }).__appStore = useAppStore;
}

// Convenience selectors — import these instead of reaching into the store directly
export const useActiveModal = () => useAppStore((s) => s.activeModal);
export const useOpenModal = () => useAppStore((s) => s.openModal);
export const useA2pStatus = () => useAppStore((s) => s.a2pStatus);
export const useCloseModal = () => useAppStore((s) => s.closeModal);
export const usePushModal = () => useAppStore((s) => s.pushModal);
export const useLeads = () => useAppStore((s) => s.leads);
export const useCompanies = () => useAppStore((s) => s.companies);
export const useEstimates = () => useAppStore((s) => s.estimates);
export const useTasks = () => useAppStore((s) => s.tasks);
export const useCustSeg = () => useAppStore((s) => s.custSeg);
export const useSetCustSeg = () => useAppStore((s) => s.setCustSeg);
export const useActiveCall = () => useAppStore((s) => s.activeCall);
