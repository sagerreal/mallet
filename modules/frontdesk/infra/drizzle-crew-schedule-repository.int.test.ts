import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { sql } from "drizzle-orm";
import { asOrgId, asUserId } from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { DrizzleCrewScheduleRepository } from "./drizzle-crew-schedule-repository";

// Live RLS integration for the Task 2.2b crew-schedule write path. Proves:
// (a) replaceForUser inserts rows readable via listForOrg
// (b) a second replaceForUser for the same user replaces (no ghost rows)
// (c) empty entries clear the user's rows
// (d) RLS isolation — org B's session cannot see org A's rows; cross-org insert rejected (WITH CHECK)
// Skipped when DB env vars are absent.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

suite("DrizzleCrewScheduleRepository — write path against live Supabase RLS", () => {
  let admin: Sql;
  let orgId = "";
  let otherOrgId = "";
  let crew1Id = "";
  let crew2Id = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });

    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('CrewSchedWrite ' || gen_random_uuid()) returning id`;
    orgId = o!.id;

    const [o2] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('CrewSchedWriteOther ' || gen_random_uuid()) returning id`;
    otherOrgId = o2!.id;

    // Two field-crew members in org A.
    const [c1] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgId}, gen_random_uuid(), 'wc1@test.ex', 'tech', true) returning id`;
    const [c2] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgId}, gen_random_uuid(), 'wc2@test.ex', 'tech', true) returning id`;
    crew1Id = c1!.id;
    crew2Id = c2!.id;

    // Org B's field-crew member (should stay invisible to org A sessions).
    await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${otherOrgId}, gen_random_uuid(), 'wcB@test.ex', 'tech', true) returning id`;
  });

  afterAll(async () => {
    if (orgId) {
      await admin`delete from crew_schedules where org_id in (${orgId}, ${otherOrgId})`;
      await admin`delete from users where org_id in (${orgId}, ${otherOrgId})`;
      await admin`delete from orgs where id in (${orgId}, ${otherOrgId})`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("replaceForUser inserts rows that are readable via listForOrg", async () => {
    const org = asOrgId(orgId);
    const user = asUserId(crew1Id);

    await withTenant(org, async (tx) => {
      const repo = new DrizzleCrewScheduleRepository(tx, org);
      // Start empty — insert Mon + Tue for crew1.
      const { CrewScheduleEntry } = await import("../domain/crew-schedule");
      const mon = CrewScheduleEntry.create({ weekday: 1, openHour: 8, closeHour: 17 });
      const tue = CrewScheduleEntry.create({ weekday: 2, openHour: 8, closeHour: 16 });
      expect(mon.ok).toBe(true);
      expect(tue.ok).toBe(true);

      await repo.replaceForUser(user, [mon.ok ? mon.value : (null as never), tue.ok ? tue.value : (null as never)]);

      const rows = await repo.listForOrg();
      const crew1Rows = rows.filter((r) => r.userId === user);
      expect(crew1Rows).toHaveLength(2);
      expect(crew1Rows).toEqual([
        { userId: user, weekday: 1, openHour: 8, closeHour: 17 },
        { userId: user, weekday: 2, openHour: 8, closeHour: 16 },
      ]);
    });
  });

  it("second replaceForUser for the same user replaces — old rows gone, new rows present", async () => {
    const org = asOrgId(orgId);
    const user = asUserId(crew1Id);

    await withTenant(org, async (tx) => {
      const repo = new DrizzleCrewScheduleRepository(tx, org);
      const { CrewScheduleEntry } = await import("../domain/crew-schedule");

      // Now replace with only Sat (weekday 6).
      const sat = CrewScheduleEntry.create({ weekday: 6, openHour: 9, closeHour: 13 });
      expect(sat.ok).toBe(true);
      await repo.replaceForUser(user, [sat.ok ? sat.value : (null as never)]);

      const rows = await repo.listForOrg();
      const crew1Rows = rows.filter((r) => r.userId === user);
      // Mon/Tue from the previous test are gone; only Sat remains.
      expect(crew1Rows).toHaveLength(1);
      expect(crew1Rows[0]).toEqual({ userId: user, weekday: 6, openHour: 9, closeHour: 13 });
    });
  });

  it("empty entries clears the user's rows", async () => {
    const org = asOrgId(orgId);
    const user = asUserId(crew1Id);

    await withTenant(org, async (tx) => {
      const repo = new DrizzleCrewScheduleRepository(tx, org);
      await repo.replaceForUser(user, []);

      const rows = await repo.listForOrg();
      const crew1Rows = rows.filter((r) => r.userId === user);
      expect(crew1Rows).toHaveLength(0);
    });
  });

  it("org B session cannot see org A's rows (RLS isolation)", async () => {
    const orgA = asOrgId(orgId);
    const orgB = asOrgId(otherOrgId);
    const user = asUserId(crew2Id);

    // Insert a row for crew2 in org A via admin.
    await admin`
      insert into crew_schedules (org_id, user_id, weekday, open_hour, close_hour)
      values (${orgId}, ${crew2Id}, 3, 7, 15)
      on conflict (org_id, user_id, weekday) do update set open_hour = excluded.open_hour`;

    // Org A session sees it.
    await withTenant(orgA, async (tx) => {
      const repo = new DrizzleCrewScheduleRepository(tx, orgA);
      const rows = await repo.listForOrg();
      expect(rows.some((r) => r.userId === user && r.weekday === 3)).toBe(true);
    });

    // Org B session must not see org A's rows.
    await withTenant(orgB, async (tx) => {
      const repo = new DrizzleCrewScheduleRepository(tx, orgB);
      const rows = await repo.listForOrg();
      expect(rows.every((r) => r.userId !== user)).toBe(true);
    });
  });

  it("cross-org insert is rejected by RLS WITH CHECK", async () => {
    const orgA = asOrgId(orgId);
    const user = asUserId(crew1Id);
    let rejected = false;

    try {
      await withTenant(orgA, async (tx) => {
        // Stamp the row with org B's id while the GUC is set to org A — WITH CHECK must reject.
        await tx.execute(sql`
          insert into crew_schedules (org_id, user_id, weekday, open_hour, close_hour)
          values (${otherOrgId}, ${user}, 4, 8, 17)`);
      });
    } catch {
      rejected = true;
    }

    expect(rejected).toBe(true);
  });
});
