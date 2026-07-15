import type { Result, AppError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

export interface CrewScheduleEntryProps {
  readonly weekday: number; // 0–6
  readonly openHour: number; // 0–24
  readonly closeHour: number; // 0–24
}

export class CrewScheduleEntry {
  private constructor(private readonly p: CrewScheduleEntryProps) {}

  static create(input: {
    weekday: number;
    openHour: number;
    closeHour: number;
  }): Result<CrewScheduleEntry, AppError> {
    if (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) {
      return err(validation("weekday must be an integer in [0, 6]", "weekday"));
    }
    if (!Number.isInteger(input.openHour) || input.openHour < 0 || input.openHour > 24) {
      return err(validation("openHour must be an integer in [0, 24]", "openHour"));
    }
    if (!Number.isInteger(input.closeHour) || input.closeHour < 0 || input.closeHour > 24) {
      return err(validation("closeHour must be an integer in [0, 24]", "closeHour"));
    }
    // Reject inverted window (open > close). Equal hours are allowed (e.g. 0/0 = closed day).
    if (input.openHour > input.closeHour) {
      return err(validation("openHour must not exceed closeHour", "closeHour"));
    }
    return ok(
      new CrewScheduleEntry({
        weekday: input.weekday,
        openHour: input.openHour,
        closeHour: input.closeHour,
      }),
    );
  }

  get props(): CrewScheduleEntryProps {
    return this.p;
  }
}
