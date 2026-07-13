import type { ServiceId } from "@mallet/shared/types";

/** One active pricebook service's identity + display name. */
export interface ServiceNameEntry {
  readonly id: ServiceId;
  readonly name: string;
}

/**
 * Read-only port: the org's active pricebook service names. The edit-delta
 * miner uses it to anchor an observation to a real service — recurrence
 * equivalence by service id is robust where description strings are not
 * (the AI phrases the same line differently per estimate). org scoping is
 * implicit in the tenant-scoped tx (RLS); implementations also filter
 * explicitly (defense-in-depth, house rule).
 */
export interface ServiceNameReader {
  listActiveNames(): Promise<ServiceNameEntry[]>;
}
