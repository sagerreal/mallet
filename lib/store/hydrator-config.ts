/**
 * lib/store/hydrator-config.ts
 * Shared constants for store hydrators. Centralised here so they stay in sync
 * and readers understand the rationale at a glance.
 */

/** 30 s stale-time keeps lists fresh without hammering the server. */
export const HYDRATOR_STALE_MS = 30_000;

/** 500 = pilot ceiling; cursor iteration is needed for any org beyond this. */
export const HYDRATOR_PAGE_LIMIT = 500;

/** Origin tag stamped on jobs that arrived from the DB vs. created locally. */
export const JOB_ORIGIN = {
  DB: "db",
  MANUAL: "manual",
} as const;

export type JobOrigin = (typeof JOB_ORIGIN)[keyof typeof JOB_ORIGIN];
