import type { UserId } from "@mallet/shared/types";
import type { CrewDaySchedule } from "./availability";
import type { CrewScheduleEntry } from "./crew-schedule";

export interface CrewScheduleRepository {
  // All crew_schedules rows for the org (any crew), ordered userId then weekday.
  listForOrg(): Promise<CrewDaySchedule[]>;
  // Replace ALL rows for one crew with `entries` (delete-then-insert, atomic in the org tx).
  replaceForUser(userId: UserId, entries: readonly CrewScheduleEntry[]): Promise<void>;
}
