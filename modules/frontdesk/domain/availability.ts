import type { BookedVisit } from "../app/slots";

// What the availability layer needs to know about the org's current schedule to compute open slots.
// `crewCount` is the number of field-crew members (each can run one visit per window); `visits` are
// the booked visits inside the lookahead range. Both come from ONE reader (no N+1) so the
// check_availability tool stays inside Vapi's per-tool budget.
export interface AvailabilitySnapshot {
  readonly crewCount: number;
  readonly visits: readonly BookedVisit[];
}

// Port over the schedule read path: given a calendar-date range [fromDate, toDate] (inclusive,
// "YYYY-MM-DD"), return the org's field-crew size and every booked visit whose scheduled_date falls
// in that range. Constructed with a tenant-scoped tx + orgId; RLS + explicit org_id predicates keep
// it tenant-safe. The application layer (computeSlots) turns this snapshot into offerable windows.
export interface AvailabilityReader {
  read(range: { fromDate: string; toDate: string }): Promise<AvailabilitySnapshot>;
}
