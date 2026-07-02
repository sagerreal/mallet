/**
 * lib/store/modal-ids.ts
 * Single source of truth for all modal identifiers — no magic strings.
 */

export const MODAL = {
  LEAD: "lead",
  NEW_CUSTOMER: "new-customer",
  CALL: "call",
  THREAD: "thread",
  VISIT: "visit",
  COMPOSER: "composer",
  CLEAN_UP: "clean-up",
  SWEEP: "sweep",
} as const;

export type ModalId = (typeof MODAL)[keyof typeof MODAL];
