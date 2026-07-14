import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { asOrgId } from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { DrizzleAvailabilityReader } from "./drizzle-availability-reader";

// Live RLS integration for the B1 availability reader. Proves it (a) reads booked visits in a
// calendar-date range, org-scoped and soft-delete filtered, (b) counts the field-crew headcount,
// and (c) never sees another org's visits. Skipped without DB.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

suite("B1 availability reader against live Supabase RLS", () => {
  let admin: Sql;
  let orgId = "";
  let otherOrgId = "";

  const RANGE = { fromDate: "2026-08-10", toDate: "2026-08-15" };

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });

    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('B1Avail ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const [o2] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('B1AvailOther ' || gen_random_uuid()) returning id`;
    otherOrgId = o2!.id;

    // Two field-crew members in our org + one non-field member (must NOT count) + one crew in the
    // other org (must NOT count under RLS).
    await admin`insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgId}, gen_random_uuid(), 'crew1@b1.ex', 'tech', true)`;
    await admin`insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgId}, gen_random_uuid(), 'crew2@b1.ex', 'tech', true)`;
    await admin`insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgId}, gen_random_uuid(), 'office@b1.ex', 'office', false)`;
    await admin`insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${otherOrgId}, gen_random_uuid(), 'crewX@b1.ex', 'tech', true)`;

    // A lead + job in each org, then booked visits.
    const [lead] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Avail Lead') returning id`;
    const [job] = await admin<{ id: string }[]>`
      insert into jobs (org_id, num, lead_id, status) values (${orgId}, 'A1', ${lead!.id}, 'scheduled') returning id`;

    // In-range pending morning visit (counts) + in-range canceled visit (excluded) + soft-deleted
    // (excluded) + out-of-range (excluded).
    await admin`insert into job_visits (org_id, job_id, scheduled_date, scheduled_start, duration_minutes, status)
      values (${orgId}, ${job!.id}, '2026-08-11', '09:00:00', 90, 'pending')`;
    await admin`insert into job_visits (org_id, job_id, scheduled_date, scheduled_start, duration_minutes, status)
      values (${orgId}, ${job!.id}, '2026-08-12', '10:00:00', 60, 'canceled')`;
    await admin`insert into job_visits (org_id, job_id, scheduled_date, scheduled_start, duration_minutes, status, deleted_at)
      values (${orgId}, ${job!.id}, '2026-08-13', '11:00:00', 60, 'pending', now())`;
    await admin`insert into job_visits (org_id, job_id, scheduled_date, scheduled_start, duration_minutes, status)
      values (${orgId}, ${job!.id}, '2026-09-01', '09:00:00', 60, 'pending')`;

    // Other org's in-range visit — RLS must hide it.
    const [leadX] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${otherOrgId}, 'Other Lead') returning id`;
    const [jobX] = await admin<{ id: string }[]>`
      insert into jobs (org_id, num, lead_id, status) values (${otherOrgId}, 'X1', ${leadX!.id}, 'scheduled') returning id`;
    await admin`insert into job_visits (org_id, job_id, scheduled_date, scheduled_start, duration_minutes, status)
      values (${otherOrgId}, ${jobX!.id}, '2026-08-11', '09:00:00', 60, 'pending')`;
  });

  afterAll(async () => {
    if (orgId) {
      await admin`delete from jobs where org_id in (${orgId}, ${otherOrgId})`;
      await admin`delete from leads where org_id in (${orgId}, ${otherOrgId})`;
      await admin`delete from orgs where id in (${orgId}, ${otherOrgId})`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("reads only in-range, active, non-deleted visits for the org", async () => {
    const org = asOrgId(orgId);
    await withTenant(org, async (tx) => {
      const snapshot = await new DrizzleAvailabilityReader(tx, org).read(RANGE);
      // Only the 08-11 pending visit qualifies (canceled/soft-deleted/out-of-range all excluded).
      expect(snapshot.visits).toHaveLength(1);
      expect(snapshot.visits[0]).toMatchObject({
        date: "2026-08-11",
        startHHMM: "09:00",
        durationMinutes: 90,
      });
    });
  });

  it("counts only this org's field-crew members", async () => {
    const org = asOrgId(orgId);
    await withTenant(org, async (tx) => {
      const snapshot = await new DrizzleAvailabilityReader(tx, org).read(RANGE);
      // Two crew in our org; the office member and the other org's crew are excluded.
      expect(snapshot.crewCount).toBe(2);
    });
  });

  it("returns this org's field-crew user ids in a stable order (RLS-scoped)", async () => {
    const org = asOrgId(orgId);
    await withTenant(org, async (tx) => {
      const reader = new DrizzleAvailabilityReader(tx, org);
      const ids = await reader.readFieldCrewIds();
      // Exactly the two field-crew members of THIS org (office member + other org's crew excluded).
      expect(ids).toHaveLength(2);
      // Stable order across calls (created_at, id) so "the first field crew" is deterministic.
      const again = await reader.readFieldCrewIds();
      expect(again).toEqual(ids);
    });
  });

  it("never sees the other org's in-range visit", async () => {
    const org = asOrgId(orgId);
    await withTenant(org, async (tx) => {
      const snapshot = await new DrizzleAvailabilityReader(tx, org).read(RANGE);
      // The other org also has an 08-11 visit, but we only ever get exactly one (ours).
      expect(snapshot.visits).toHaveLength(1);
    });
  });
});
