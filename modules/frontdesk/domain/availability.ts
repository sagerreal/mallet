import type { UserId } from "@mallet/shared/types";
import type { BookedVisit } from "../app/slots";
import type { CrewLoad } from "../app/dispatch";

// What the availability layer needs to know about the org's current schedule to compute open slots.
// `crewCount` is the number of field-crew members (each can run one visit per window); `visits` are
// the booked visits inside the lookahead range. Both come from ONE reader (no N+1) so the
// check_availability tool stays inside Vapi's per-tool budget.
export interface AvailabilitySnapshot {
  readonly crewCount: number;
  readonly visits: readonly BookedVisit[];
}

// One field-crew member's working hours for a single weekday. `weekday` follows JS getDay()
// (0 = Sunday .. 6 = Saturday); `openHour`/`closeHour` are whole hours in [0, 24]. A crew with NO
// row for a weekday means "use the org's default hours" — that FALLBACK is applied by the slot math
// (Task 2.2), not the reader, which returns only the raw override rows.
export interface CrewDaySchedule {
  readonly userId: UserId;
  readonly weekday: number;
  readonly openHour: number;
  readonly closeHour: number;
}

// Port over the schedule read path. `read` returns the field-crew size + booked visits for the slot
// math; `readFieldCrewIds` returns the org's field-crew USER IDS so a voice booking can be assigned
// to a real crew member and land ON THE BOARD (book_visit picks the first). Both are org-scoped
// (RLS + explicit org_id predicates) and query-only (DI + repository pattern). Constructed with a
// tenant-scoped tx + orgId. The application layer (computeSlots / book_visit) consumes the results.
export interface AvailabilityReader {
  read(range: { fromDate: string; toDate: string }): Promise<AvailabilitySnapshot>;
  // The org's field-crew user ids in a STABLE order (created_at, then id — oldest crew first), so
  // "the first field crew" is deterministic across calls. Empty when the org has no field crew.
  readFieldCrewIds(): Promise<UserId[]>;
  // Every crew_schedules row for the org's FIELD crew (one row per crew-day override). Org-scoped
  // (RLS + explicit org_id predicate), one query (no N+1). A crew-day with no row is absent here;
  // the slot math (Task 2.2) fills those from the org's default hours. Empty when no overrides.
  readCrewSchedules(): Promise<CrewDaySchedule[]>;
  // Every FIELD crew member with the geolocated points of their ACTIVE visits on `date`
  // (one CrewLoad per field crew, INCLUDING crew with zero same-day jobs → empty sameDayJobs).
  // Org-scoped, query-only, no N+1. Used by book_visit's chooseCrew to balance + place by proximity.
  readSameDayCrewLoads(date: string): Promise<CrewLoad[]>;
}
