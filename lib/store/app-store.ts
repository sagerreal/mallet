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
import { createEstimatesSlice, type EstimatesSlice } from "./slices/estimates-slice";
import { createJobsSlice, type JobsSlice } from "./slices/jobs-slice";
import { createInvoicesSlice, type InvoicesSlice } from "./slices/invoices-slice";
import { createCallSlice, type CallSlice } from "./slices/call-slice";
import { createTimesheetsSlice, type TimesheetsSlice } from "./slices/timesheets-slice";
import { createChecklistsSlice, type ChecklistsSlice } from "./slices/checklists-slice";

export type AppStore = UISlice &
  LeadsSlice &
  DataSlice &
  EstimatesSlice &
  JobsSlice &
  InvoicesSlice &
  CallSlice &
  TimesheetsSlice &
  ChecklistsSlice;

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
}));

// Convenience selectors — import these instead of reaching into the store directly
export const useActiveModal = () => useAppStore((s) => s.activeModal);
export const useOpenModal = () => useAppStore((s) => s.openModal);
export const useCloseModal = () => useAppStore((s) => s.closeModal);
export const useLeads = () => useAppStore((s) => s.leads);
export const useEstimates = () => useAppStore((s) => s.estimates);
export const useTasks = () => useAppStore((s) => s.tasks);
export const useCustSeg = () => useAppStore((s) => s.custSeg);
export const useSetCustSeg = () => useAppStore((s) => s.setCustSeg);
export const useActiveCall = () => useAppStore((s) => s.activeCall);
