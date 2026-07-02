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
  QUOTE_SWEEP: "quote-sweep",
  EST: "est",
  JOB: "job",
  NEW_JOB: "new-job",
  JOB_SWEEP: "job-sweep",
  EVISIT: "evisit",
  PRICE_BUILDER: "price-builder",
  STANDARDS: "standards",
  INVOICE: "invoice",
  TECH_JOB: "tech-job",
} as const;

export type ModalId = (typeof MODAL)[keyof typeof MODAL];
