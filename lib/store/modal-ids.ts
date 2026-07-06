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
  CUST_QUOTE: "cust-quote",
  CUST_INVOICE: "cust-invoice",
  CLOSE_OUT: "close-out",
  TECH_QUOTE: "tech-quote",
  COMPANY: "company",
} as const;

export type ModalId = (typeof MODAL)[keyof typeof MODAL];
