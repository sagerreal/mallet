/**
 * lib/store/slices/ui-slice.ts
 * UI ephemeral state: active modal + customer segment selector.
 */

import type { StateCreator } from "zustand";
import type { ActiveModal, UIState } from "../types";
import type { ModalId } from "../modal-ids";

export interface UISlice extends UIState {
  openModal: (id: ModalId, params?: Record<string, unknown>) => void;
  closeModal: () => void;
  setCustSeg: (seg: "people" | "biz") => void;
}

export const createUISlice: StateCreator<UISlice, [], [], UISlice> = (set) => ({
  // state
  activeModal: null,
  custSeg: "people",

  // actions
  openModal: (id: ModalId, params?: Record<string, unknown>) =>
    set({ activeModal: { id, params } }),

  closeModal: () => set({ activeModal: null }),

  setCustSeg: (seg) => set({ custSeg: seg }),
});
