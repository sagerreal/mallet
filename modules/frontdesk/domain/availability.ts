import type { UserId } from "@mallet/shared/types";
import type { BookedVisit } from "../app/slots";

// What the availability layer needs to know about the org's current schedule to compute open slots.
// `crewCount` is the number of field-crew members (each can run one visit per window); `visits` are
// the booked visits inside the lookahead range. Both come from ONE reader (no N+1) so the
// check_availability tool stays inside Vapi's per-tool budget.
export interface AvailabilitySnapshot {
  readonly crewCount: number;
  readonly visits: readonly BookedVisit[];
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
}
