import { and, eq, isNotNull } from "drizzle-orm";
import { users, crewSchedules } from "@mallet/shared/db/schema";
import { withTenant } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import { asOrgId } from "@mallet/shared/types";
import type { OnCallCandidate, OnCallReader } from "../domain/on-call";

/**
 * The staff a shop has said may be interrupted by a caller, with their hours for one weekday.
 *
 * LEFT JOIN on crew_schedules on purpose: most office staff have no schedule rows, and an inner
 * join would silently return nobody — turning the feature on would look like it had disabled
 * escalation. A null `todayHours` means "inherit the org's hours", which pickOnCall handles.
 *
 * Opens its own short tenant transaction: this runs from the Vapi webhook, which has no principal
 * and no open tx, and Vapi's assistant-request budget is about 7.5 seconds — one indexed read.
 */
export class DrizzleOnCallReader implements OnCallReader {
  async findAvailable(orgId: string, weekday: number): Promise<readonly OnCallCandidate[]> {
    const tenant: OrgId = asOrgId(orgId);
    return withTenant(tenant, async (tx) => {
      const rows = await tx
        .select({
          userId: users.id,
          name: users.name,
          phone: users.callbackNumber,
          openHour: crewSchedules.openHour,
          closeHour: crewSchedules.closeHour,
        })
        .from(users)
        .leftJoin(
          crewSchedules,
          and(
            eq(crewSchedules.orgId, users.orgId),
            eq(crewSchedules.userId, users.id),
            eq(crewSchedules.weekday, weekday),
          ),
        )
        .where(
          and(
            eq(users.orgId, tenant),
            eq(users.takesCalls, true),
            // Verified only. An unverified callback_number is digits typed into a settings box;
            // putting a customer through to one is a worse failure than not transferring.
            isNotNull(users.callbackNumber),
            isNotNull(users.callbackVerifiedAt),
          ),
        );

      return rows.map((r) => ({
        userId: r.userId,
        name: r.name,
        phone: r.phone as string,
        todayHours:
          r.openHour === null || r.closeHour === null
            ? null
            : { openHour: r.openHour, closeHour: r.closeHour },
      }));
    });
  }
}
