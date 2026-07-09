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
  dismissAttention: (key: string) => void;
  undismissAttention: (key: string) => void;
  /** Hand a query to the command bar (it consumes the seed and focuses). */
  seedCommand: (q: string) => void;
  clearCmdSeed: () => void;
}

export const createUISlice: StateCreator<UISlice, [], [], UISlice> = (set) => ({
  // state
  activeModal: null,
  custSeg: "people",
  dismissedAttention: [],
  cmdSeed: null,

  // actions
  openModal: (id: ModalId, params?: Record<string, unknown>) =>
    set({ activeModal: { id, params } }),

  closeModal: () => set({ activeModal: null }),

  setCustSeg: (seg) => set({ custSeg: seg }),

  dismissAttention: (key) =>
    set((s) => ({ dismissedAttention: [...s.dismissedAttention, key] })),

  // Undo path for a just-sent queue card — the item may lead again.
  undismissAttention: (key) =>
    set((s) => ({ dismissedAttention: s.dismissedAttention.filter((k) => k !== key) })),

  seedCommand: (q) => set({ cmdSeed: q }),
  clearCmdSeed: () => set({ cmdSeed: null }),
});
