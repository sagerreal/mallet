import { and, asc, eq } from "drizzle-orm";
import { crewSchedules } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { asUserId } from "@mallet/shared/types";
import type { OrgId, UserId } from "@mallet/shared/types";
import type { CrewDaySchedule } from "../domain/availability";
import type { CrewScheduleRepository } from "../domain/crew-schedule-repository";
import type { CrewScheduleEntry } from "../domain/crew-schedule";

export class DrizzleCrewScheduleRepository implements CrewScheduleRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async listForOrg(): Promise<CrewDaySchedule[]> {
    const rows = await this.tx
      .select({
        orgId: crewSchedules.orgId,
        userId: crewSchedules.userId,
        weekday: crewSchedules.weekday,
        openHour: crewSchedules.openHour,
        closeHour: crewSchedules.closeHour,
      })
      .from(crewSchedules)
      .where(eq(crewSchedules.orgId, this.orgId))
      .orderBy(asc(crewSchedules.userId), asc(crewSchedules.weekday));

    return rows.map((r) => ({
      userId: asUserId(r.userId),
      weekday: Number(r.weekday),
      openHour: Number(r.openHour),
      closeHour: Number(r.closeHour),
    }));
  }

  async replaceForUser(userId: UserId, entries: readonly CrewScheduleEntry[]): Promise<void> {
    await this.tx
      .delete(crewSchedules)
      .where(and(eq(crewSchedules.orgId, this.orgId), eq(crewSchedules.userId, userId)));

    if (entries.length === 0) return;

    await this.tx.insert(crewSchedules).values(
      entries.map((e) => ({
        orgId: this.orgId,
        userId,
        weekday: e.props.weekday,
        openHour: e.props.openHour,
        closeHour: e.props.closeHour,
      })),
    );
  }
}
