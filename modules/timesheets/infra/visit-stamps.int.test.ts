import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { asOrgId, asUserId } from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { DrizzleVisitStampsReader } from "./drizzle-visit-stamps-reader";

/**
 * What a week's hours were spent on, against the live database.
 *
 * This has to be an integration test, not a unit test. The query aliases `job_visits` as `v` and
 * builds its work-date expression as raw SQL, and the sibling reader in this folder proved what
 * happens when that is got wrong: Postgres rejects the whole statement, the panel renders EMPTY, and
 * an empty attribution panel is indistinguishable from a week with no visits. A browser cannot tell
 * those apart. This can.
 *
 * It also pins the joins, which are the part most likely to silently drop rows: a job whose customer
 * record is gone still has hours worth showing, and another shop's visits must never appear.
 */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const MON = "2026-06-01";
const TUE = "2026-06-02";
const WED = "2026-06-03";
const THU = "2026-06-04";

suite("visit stamps (live DB)", () => {
  let admin: Sql;
  let orgId = "";
  let otherOrgId = "";
  let techId = "";
  let mateId = "";
  let jobId = "";
  let noCustomerJobId = "";

  const addVisit = async (v: {
    date: string | null;
    tech: string | null;
    started?: string | null;
    completed?: string | null;
    status?: string;
    org?: string;
    job?: string;
    deleted?: boolean;
  }) => {
    await admin`
      insert into job_visits
        (org_id, job_id, scheduled_date, assignee_user_id, started_at, completed_at, duration_minutes, status, deleted_at)
      values
        (${v.org ?? orgId}, ${v.job ?? jobId}, ${v.date}, ${v.tech}, ${v.started ?? null},
         ${v.completed ?? null}, 120, ${v.status ?? "complete"}, ${v.deleted ? new Date() : null})`;
  };

  const read = (from: string, to: string, who = techId) =>
    withTenant(asOrgId(orgId), (tx) =>
      new DrizzleVisitStampsReader(tx, asOrgId(orgId)).find(from, to, asUserId(who)),
    );

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('Stamps ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const [o2] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('StampsOther ' || gen_random_uuid()) returning id`;
    otherOrgId = o2!.id;

    const mkUser = async (org: string) => {
      const [u] = await admin<{ id: string }[]>`
        insert into users (org_id, auth_user_id, email, name, role, is_field_crew)
        values (${org}, gen_random_uuid(), 'u-' || gen_random_uuid() || '@stamps.test', 'Crew', 'tech', true)
        returning id`;
      return u!.id;
    };
    techId = await mkUser(orgId);
    mateId = await mkUser(orgId);

    const [l] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Alvarez') returning id`;
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, title, status, total_cents)
      values (${orgId}, ${l!.id}, 'S-1', 'Water heater swap', 'complete', 0) returning id`;
    jobId = j!.id;

    // A job with no title, whose customer is ARCHIVED below. Archiving is the only removal the app
    // performs on a customer (deleteLead → archiveLead, recoverable); a hard delete cascades the job
    // away entirely, so it is not a state this reader can ever meet.
    const [l2] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Archived Customer') returning id`;
    const [j2] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, title, status, total_cents)
      values (${orgId}, ${l2!.id}, 'S-2', null, 'complete', 0) returning id`;
    noCustomerJobId = j2!.id;

    // MONDAY — two stamped visits, out of order on purpose.
    await addVisit({ date: MON, tech: techId, started: `${MON}T19:00:00Z`, completed: `${MON}T20:00:00Z` });
    await addVisit({ date: MON, tech: techId, started: `${MON}T15:00:00Z`, completed: `${MON}T17:30:00Z` });

    // TUESDAY — arrived, never finished. Still on the job.
    await addVisit({ date: TUE, tech: techId, started: `${TUE}T15:00:00Z`, status: "in_progress" });

    // TUESDAY — booked, never tapped. Must come back with nulls, not be dropped.
    await addVisit({ date: TUE, tech: techId, status: "pending" });

    // WEDNESDAY — canceled, and a soft-deleted visit. Neither is time anybody worked.
    await addVisit({ date: WED, tech: techId, started: `${WED}T15:00:00Z`, completed: `${WED}T16:00:00Z`, status: "canceled" });
    await addVisit({ date: WED, tech: techId, started: `${WED}T17:00:00Z`, completed: `${WED}T18:00:00Z`, deleted: true });

    // WEDNESDAY — a MATE's visit in the same org. A man's own screen shows his own jobs.
    await addVisit({ date: WED, tech: mateId, started: `${WED}T15:00:00Z`, completed: `${WED}T16:00:00Z` });

    // THURSDAY — the untitled job, and its customer archived after the fact.
    await addVisit({ date: THU, tech: techId, job: noCustomerJobId, started: `${THU}T15:00:00Z`, completed: `${THU}T16:00:00Z` });
    await admin`update leads set deleted_at = now() where org_id = ${orgId} and name = 'Archived Customer'`;

    // Another shop entirely, same week, same dates.
    const [ol] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${otherOrgId}, 'Other Shop') returning id`;
    const [oj] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents)
      values (${otherOrgId}, ${ol!.id}, 'S-OTHER', 'complete', 0) returning id`;
    const otherTech = await mkUser(otherOrgId);
    await addVisit({ org: otherOrgId, job: oj!.id, date: MON, tech: otherTech, started: `${MON}T15:00:00Z`, completed: `${MON}T16:00:00Z` });
  });

  afterAll(async () => {
    for (const org of [orgId, otherOrgId]) {
      if (!org) continue;
      await admin`delete from job_visits where org_id = ${org}`;
      await admin`delete from jobs where org_id = ${org}`;
      await admin`delete from leads where org_id = ${org}`;
      await admin`delete from orgs where id = ${org}`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("returns INSTANTS, in the order the day happened", async () => {
    // Instants, not wall clocks: `to_char` in SQL renders in the DATABASE's timezone (UTC), so a
    // technician who arrived at eight in California read "3p" on his own timesheet. The browser is
    // the only participant that knows which clock he means.
    const rows = await read(MON, MON);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.startedAt).toBe(`${MON}T15:00:00.000Z`);
    expect(rows[0]?.completedAt).toBe(`${MON}T17:30:00.000Z`);
    expect(rows[1]?.startedAt).toBe(`${MON}T19:00:00.000Z`);
  });

  it("carries what the technician calls the job, and who it was for", async () => {
    const [row] = await read(MON, MON);
    expect(row?.jobNum).toBe("S-1");
    expect(row?.jobTitle).toBe("Water heater swap");
    expect(row?.customerName).toBe("Alvarez");
  });

  it("returns a visit still in progress with no end — not a fabricated one", async () => {
    const rows = await read(TUE, TUE);
    const running = rows.find((r) => r.startedAt === `${TUE}T15:00:00.000Z`);
    expect(running).toBeTruthy();
    expect(running?.completedAt).toBeNull();
  });

  it("KEEPS a booked visit nobody tapped, with both times null", async () => {
    // Dropping it is how a missing tap becomes invisible, and a missing tap is the one thing on this
    // panel anybody needs to act on.
    const rows = await read(TUE, TUE);
    const untapped = rows.filter((r) => r.startedAt === null);
    expect(untapped).toHaveLength(1);
    expect(untapped[0]?.completedAt).toBeNull();
  });

  it("still names an ARCHIVED customer — the hours were worked for them either way", async () => {
    const [row] = await read(THU, THU);
    expect(row?.jobNum).toBe("S-2");
    expect(row?.customerName).toBe("Archived Customer");
    // No title on this job, so the UI falls back to the number the technician calls it by.
    expect(row?.jobTitle).toBeNull();
  });

  it("excludes canceled and soft-deleted visits", async () => {
    const rows = await read(WED, WED);
    expect(rows).toEqual([]);
  });

  it("shows a man his OWN jobs, never a mate's", async () => {
    const mine = await read(WED, WED, techId);
    const theirs = await read(WED, WED, mateId);
    expect(mine).toEqual([]);
    expect(theirs).toHaveLength(1);
  });

  it("never crosses orgs, even on the same date", async () => {
    const rows = await read(MON, MON);
    expect(rows.every((r) => r.jobNum !== "S-OTHER")).toBe(true);
  });

  it("spans a whole week in one read", async () => {
    const rows = await read(MON, THU);
    // Monday's two + Tuesday's two + Thursday's one. Wednesday contributes nothing.
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.workDate)).toEqual([MON, MON, TUE, TUE, THU]);
  });
});
