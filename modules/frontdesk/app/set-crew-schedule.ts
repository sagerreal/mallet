import type { OrgId, AppError, Result } from "@mallet/shared/types";
import { asUserId, validation, ok, err } from "@mallet/shared/types";
import type { CrewDaySchedule } from "../domain/availability";
import type { CrewScheduleRepository } from "../domain/crew-schedule-repository";
import { CrewScheduleEntry } from "../domain/crew-schedule";

interface SetCrewScheduleCmd {
  readonly userId: string;
  readonly entries: readonly { weekday: number; openHour: number; closeHour: number }[];
}

export class SetCrewScheduleUseCase {
  constructor(private readonly repo: CrewScheduleRepository) {}

  async exec(
    cmd: SetCrewScheduleCmd,
    _orgId: OrgId,
  ): Promise<Result<CrewDaySchedule[], AppError>> {
    // 1. Reject duplicate weekdays before any writes.
    const weekdays = cmd.entries.map((e) => e.weekday);
    const seen = new Set<number>();
    for (const wd of weekdays) {
      if (seen.has(wd)) {
        return err(validation("duplicate weekday in entries", "weekday"));
      }
      seen.add(wd);
    }

    // 2. Validate each entry through the domain value object; fail fast on first error.
    const validated: CrewScheduleEntry[] = [];
    for (const raw of cmd.entries) {
      const result = CrewScheduleEntry.create(raw);
      if (!result.ok) return result;
      validated.push(result.value);
    }

    // 3. Replace persisted rows for this user.
    const userId = asUserId(cmd.userId);
    await this.repo.replaceForUser(userId, validated);

    // 4. Return the user's updated rows from the authoritative store.
    const all = await this.repo.listForOrg();
    return ok(all.filter((r) => r.userId === userId));
  }
}
