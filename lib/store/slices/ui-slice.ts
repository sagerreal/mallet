/**
 * lib/store/slices/ui-slice.ts
 * UI ephemeral state: active modal + customer segment selector.
 */

import type { StateCreator } from "zustand";
import type { ActiveModal, UIState } from "../types";
import type { ModalId } from "../modal-ids";

export interface UISlice extends UIState {
  /** ROOT open (from a page / command bar): replaces the modal and clears the stack. */
  openModal: (id: ModalId, params?: Record<string, unknown>) => void;
  /** DRILL-IN (from inside a modal): remembers the parent; closeModal restores it. */
  pushModal: (id: ModalId, params?: Record<string, unknown>) => void;
  /** Pops to the parent drill-in if there is one, else closes — never a dead end. */
  closeModal: () => void;
  /**
   * TERMINAL close: clears the active modal AND the whole back-stack, whatever its depth.
   *
   * For a step that ENDS a flow rather than drilling into one — the field close-out's Done, where
   * the next thing the tech does is on My day, not on the job sheet he came through. Popping N
   * times would guess the depth, and the depth is not fixed: the visit-fee path pushes an extra
   * level. Use only for a genuine terminal step; a drill-in still uses closeModal.
   */
  dismissModals: () => void;
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
  modalStack: [],
  custSeg: "people",
  dismissedAttention: [],
  cmdSeed: null,

  // actions
  openModal: (id: ModalId, params?: Record<string, unknown>) =>
    set({ activeModal: { id, params }, modalStack: [] }),

  pushModal: (id: ModalId, params?: Record<string, unknown>) =>
    set((s) => ({
      activeModal: { id, params },
      modalStack: s.activeModal ? [...s.modalStack, s.activeModal] : s.modalStack,
    })),

  closeModal: () =>
    set((s) => {
      const parent = s.modalStack.at(-1) ?? null;
      return { activeModal: parent, modalStack: s.modalStack.slice(0, -1) };
    }),

  dismissModals: () => set({ activeModal: null, modalStack: [] }),

  setCustSeg: (seg) => set({ custSeg: seg }),

  dismissAttention: (key) =>
    set((s) => ({ dismissedAttention: [...s.dismissedAttention, key] })),

  // Undo path for a just-sent queue card — the item may lead again.
  undismissAttention: (key) =>
    set((s) => ({ dismissedAttention: s.dismissedAttention.filter((k) => k !== key) })),

  seedCommand: (q) => set({ cmdSeed: q }),
  clearCmdSeed: () => set({ cmdSeed: null }),
});
