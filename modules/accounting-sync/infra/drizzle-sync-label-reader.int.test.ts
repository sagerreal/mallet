import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { asOrgId } from "@mallet/shared/types";
import { DrizzleSyncLabelReader } from "./drizzle-sync-label-reader";

// Skipped when DB credentials are absent (see vitest.int.setup.ts for env loading).
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

suite("DrizzleSyncLabelReader (live RLS)", () => {
  let admin: Sql;
  let orgId = "";
  let otherOrgId = "";
  let mineId = "";
  let theirsId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 2, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('LabelReader ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('LabelReader other ' || gen_random_uuid()) returning id`;
    orgId = a!.id;
    otherOrgId = b!.id;

    const [me] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, name, role)
      values (${orgId}, gen_random_uuid(), ${`lr-${orgId}@e2e.test`}, 'Dana Alvarez', 'tech')
      returning id`;
    const [them] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, name, role)
      values (${otherOrgId}, gen_random_uuid(), ${`lr-${otherOrgId}@e2e.test`}, 'Someone Else', 'tech')
      returning id`;

    const [mine] = await admin<{ id: string }[]>`
      insert into time_entries (org_id, tech_user_id, work_date, kind, start_time, end_time, status)
      values (${orgId}, ${me!.id}, '2026-07-25', 'shop', '08:00', '16:00', 'approved') returning id`;
    const [theirs] = await admin<{ id: string }[]>`
      insert into time_entries (org_id, tech_user_id, work_date, kind, start_time, end_time, status)
      values (${otherOrgId}, ${them!.id}, '2026-07-25', 'shop', '08:00', '16:00', 'approved') returning id`;
    mineId = mine!.id;
    theirsId = theirs!.id;
  });

  afterAll(async () => {
    for (const id of [orgId, otherOrgId].filter(Boolean)) {
      await admin`delete from time_entries where org_id = ${id}`;
      await admin`delete from users where org_id = ${id}`;
      await admin`delete from orgs where id = ${id}`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  const read = (org: string, ids: string[]) =>
    withTenant(asOrgId(org), (tx) => new DrizzleSyncLabelReader(tx, org).labelsFor("time_entry", ids));

  it("names the person and the day worked", async () => {
    const labels = await read(orgId, [mineId]);
    expect(labels.get(mineId)).toBe("Dana Alvarez · Jul 25");
  });

  /**
   * The one that matters. This screen renders whatever comes back, so a leak here would print
   * another shop's crew names into this shop's payroll settings.
   */
  it("returns nothing for another org's entry, even asked for it by id", async () => {
    const labels = await read(orgId, [theirsId]);
    expect(labels.has(theirsId)).toBe(false);
    expect(labels.size).toBe(0);
  });

  it("returns only the caller's own rows from a mixed request", async () => {
    const labels = await read(orgId, [mineId, theirsId]);
    expect([...labels.keys()]).toEqual([mineId]);
  });

  it("asks nothing of the database for an empty id list", async () => {
    expect((await read(orgId, [])).size).toBe(0);
  });

  // Invoices and payments reach this reader before they are implemented; a settings screen must
  // not 500 because it met a row it cannot name.
  it("returns an empty map for an entity type it does not know", async () => {
    const labels = await withTenant(asOrgId(orgId), (tx) =>
      new DrizzleSyncLabelReader(tx, orgId).labelsFor("invoice", [mineId]),
    );
    expect(labels.size).toBe(0);
  });
});
