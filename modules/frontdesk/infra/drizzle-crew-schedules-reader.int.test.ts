import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { sql } from "drizzle-orm";
import { asOrgId } from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { DrizzleAvailabilityReader } from "./drizzle-availability-reader";

// Live RLS integration for the Task 2.1 crew-schedules read path. Proves readCrewSchedules
// (a) returns exactly THIS org's FIELD-crew schedule rows (a non-field user's rows are excluded by
// the is_field_crew join), (b) never sees another org's rows under RLS, and (c) that RLS WITH CHECK
// physically rejects a crew_schedules insert stamped with another org's id. Skipped without DB.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

suite("Task 2.1 crew-schedules reader against live Supabase RLS", () => {
  let admin: Sql;
  let orgId = "";
  let otherOrgId = "";
  let crew1Id = "";
  let crew2Id = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });

    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('CrewSched ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const [o2] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('CrewSchedOther ' || gen_random_uuid()) returning id`;
    otherOrgId = o2!.id;

    // Two field-crew members + one non-field (office) member in our org.
    const [c1] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgId}, gen_random_uuid(), 'crew1@cs.ex', 'tech', true) returning id`;
    const [c2] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgId}, gen_random_uuid(), 'crew2@cs.ex', 'tech', true) returning id`;
    const [office] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgId}, gen_random_uuid(), 'office@cs.ex', 'office', false) returning id`;
    crew1Id = c1!.id;
    crew2Id = c2!.id;

    // crew1 works Mon/Tue 8-17; crew2 works Sat 9-13. The office member ALSO has a row — it must be
    // excluded by the is_field_crew join.
    await admin`insert into crew_schedules (org_id, user_id, weekday, open_hour, close_hour)
      values (${orgId}, ${crew1Id}, 1, 8, 17), (${orgId}, ${crew1Id}, 2, 8, 17),
             (${orgId}, ${crew2Id}, 6, 9, 13),
             (${orgId}, ${office!.id}, 1, 8, 17)`;

    // Other org's field-crew member with a schedule row — RLS must hide it.
    const [cx] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${otherOrgId}, gen_random_uuid(), 'crewX@cs.ex', 'tech', true) returning id`;
    await admin`insert into crew_schedules (org_id, user_id, weekday, open_hour, close_hour)
      values (${otherOrgId}, ${cx!.id}, 3, 7, 19)`;
  });

  afterAll(async () => {
    if (orgId) {
      // crew_schedules FKs cascade off users; users cascade off orgs. Clearing orgs is enough, but
      // clear children first for clarity/robustness against partial cascades.
      await admin`delete from crew_schedules where org_id in (${orgId}, ${otherOrgId})`;
      await admin`delete from users where org_id in (${orgId}, ${otherOrgId})`;
      await admin`delete from orgs where id in (${orgId}, ${otherOrgId})`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("returns exactly this org's FIELD-crew schedule rows (office rows + other org excluded)", async () => {
    const org = asOrgId(orgId);
    await withTenant(org, async (tx) => {
      const rows = await new DrizzleAvailabilityReader(tx, org).readCrewSchedules();
      // crew1 Mon+Tue, crew2 Sat = 3 rows. Office member's row and the other org's row are excluded.
      expect(rows).toHaveLength(3);

      // SORTED BOTH SIDES, because the reader orders by (user_id, weekday) and the fixture mints
      // its users with gen_random_uuid(). Which of crew1/crew2 sorts first is therefore a COIN
      // FLIP, and a literal array here failed about half the time — the flake that has been read
      // as a broken environment more than once. What the reader actually promises is a
      // deterministic order for a GIVEN set of ids, and that is what this compares.
      const byUserThenDay = (a: { userId: string; weekday: number }, b: { userId: string; weekday: number }) =>
        a.userId === b.userId ? a.weekday - b.weekday : a.userId < b.userId ? -1 : 1;

      expect(rows).toEqual(
        [
          { userId: crew1Id, weekday: 1, openHour: 8, closeHour: 17 },
          { userId: crew1Id, weekday: 2, openHour: 8, closeHour: 17 },
          { userId: crew2Id, weekday: 6, openHour: 9, closeHour: 13 },
        ].sort(byUserThenDay),
      );
      // And the ordering promise itself, checked against the rows as they arrived.
      expect(rows).toEqual([...rows].sort(byUserThenDay));
    });
  });

  it("never sees the other org's crew schedule rows", async () => {
    const org = asOrgId(orgId);
    await withTenant(org, async (tx) => {
      const rows = await new DrizzleAvailabilityReader(tx, org).readCrewSchedules();
      // No row belongs to the other org (weekday 3 / 7-19 is theirs).
      expect(rows.every((r) => !(r.weekday === 3 && r.openHour === 7))).toBe(true);
    });
  });

  it("cannot insert a crew_schedules row stamped with another org's id (RLS WITH CHECK)", async () => {
    const orgA = asOrgId(orgId);
    let rejected = false;
    try {
      await withTenant(orgA, async (tx) => {
        // Stamp the row with the OTHER org's id while the tenant context is orgA — WITH CHECK
        // (org_id = current_org_id()) must reject it.
        await tx.execute(sql`
          insert into crew_schedules (org_id, user_id, weekday, open_hour, close_hour)
          values (${otherOrgId}, ${crew1Id}, 4, 8, 17)`);
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});
