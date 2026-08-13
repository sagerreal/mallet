/**
 * lib/store/modal-ids.ts
 * Single source of truth for all modal identifiers — no magic strings.
 */

export const MODAL = {
  LEAD: "lead",
  NEW_CUSTOMER: "new-customer",
  CALL: "call",
  THREAD: "thread",
  /** A staff conversation (DM or group) — internal, never customer-visible. */
  TEAM_CHAT: "team-chat",
  VISIT: "visit",
  CLEAN_UP: "clean-up",
  SWEEP: "sweep",
  QUOTE_SWEEP: "quote-sweep",
  EST: "est",
  JOB: "job",
  NEW_JOB: "new-job",
  PRICE_BUILDER: "price-builder",
  INVOICE: "invoice",
  TECH_JOB: "tech-job",
  CUST_QUOTE: "cust-quote",
  CUST_INVOICE: "cust-invoice",
  CLOSE_OUT: "close-out",
  TECH_QUOTE: "tech-quote",
  COMPANY: "company",
  IMPORT_CUSTOMERS: "import-customers",
  IMPORT_SERVICES: "import-services",
  IMPORT_JOBS: "import-jobs",
  IMPORT_MATERIALS: "import-materials",
  IMPORT_COMPANIES: "import-companies",
  ROOM_CARD: "room-card",
  SITE_TRACER: "site-tracer",
} as const;

export type ModalId = (typeof MODAL)[keyof typeof MODAL];
