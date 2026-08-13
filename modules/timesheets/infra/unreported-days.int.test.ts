import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { asOrgId, asUserId } from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { DrizzleUnreportedDaysReader } from "./drizzle-unreported-days-reader";

/**
 * Days somebody worked and sent in no hours, against the live database.
 *
 * This is the only timesheet gap the app interrupts anyone about, so its false-positive rate is
 * the whole design. Every case below is a shape that MUST NOT fire: a day already reported, a
 * future booking nobody has been to, a canceled visit, another shop's crew.
 */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const MON = "2026-06-01";
const TUE = "2026-06-02";
const WED = "2026-06-03";
const THU = "2026-06-04";
const FRI = "2026-06-05";
const SUN = "2026-06-07";

suite("unreported days (live DB)", () => {
  let admin: Sql;
  let orgId = "";
  let otherOrgId = "";
  let techId = "";
  let otherTechId = "";
  let leadId = "";
  let jobId = "";

  const addVisit = async (v: {
    date: string; tech: string | null; started?: string | null; completed?: string | null;
    status?: string; org?: string; job?: string;
  }) => {
    await admin`
      insert into job_visits (org_id, job_id, scheduled_date, assignee_user_id, started_at, completed_at, duration_minutes, status)
      values (${v.org ?? orgId}, ${v.job ?? jobId}, ${v.date}, ${v.tech}, ${v.started ?? null},
              ${v.completed ?? null}, 120, ${v.status ?? "complete"})`;
  };

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('Unreported ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const [o2] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('UnreportedOther ' || gen_random_uuid()) returning id`;
    otherOrgId = o2!.id;

    const mkUser = async (org: string) => {
      const [u] = await admin<{ id: string }[]>`
        insert into users (org_id, auth_user_id, email, name, role, is_field_crew)
        values (${org}, gen_random_uuid(), 'u-' || gen_random_uuid() || '@unrep.test', 'Crew', 'tech', true)
        returning id`;
      return u!.id;
    };
    techId = await mkUser(orgId);
    otherTechId = await mkUser(orgId);

    const [l] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Unreported Customer') returning id`;
    leadId = l!.id;
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents)
      values (${orgId}, ${leadId}, 'U-1', 'complete', 0) returning id`;
    jobId = j!.id;

    // MONDAY — worked and never reported. The one case that must fire.
    await addVisit({ date: MON, tech: techId, started: `${MON}T15:04:00Z`, completed: `${MON}T18:32:00Z` });
    await addVisit({ date: MON, tech: techId, started: `${MON}T19:00:00Z`, completed: `${MON}T20:00:00Z` });

    // TUESDAY — worked AND reported. Any entry on the day clears it.
    await addVisit({ date: TUE, tech: techId, started: `${TUE}T15:00:00Z`, completed: `${TUE}T17:00:00Z` });
    await admin`
      insert into time_entries (org_id, tech_user_id, work_date, kind, start_time, end_time, src, status)
      values (${orgId}, ${techId}, ${TUE}, 'shop', '08:00', '16:00', 'manual', 'draft')`;

    // WEDNESDAY — booked, nobody has been. A plan is not evidence of work.
    await addVisit({ date: WED, tech: techId, status: "pending" });

    // THURSDAY — canceled. Nobody travelled and nobody worked.
    await addVisit({ date: THU, tech: techId, started: `${THU}T15:00:00Z`, completed: `${THU}T16:00:00Z`, status: "canceled" });

    // FRIDAY — another shop's crew, same week.
    const [ol] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${otherOrgId}, 'Other') returning id`;
    const [oj] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents)
      values (${otherOrgId}, ${ol!.id}, 'U-OTHER', 'complete', 0) returning id`;
    const otherOrgTech = await mkUser(otherOrgId);
    await addVisit({ org: otherOrgId, job: oj!.id, date: FRI, tech: otherOrgTech, started: `${FRI}T15:00:00Z`, completed: `${FRI}T16:00:00Z` });

    // FRIDAY — a SECOND person in this org, so the crew-wide read has two people to separate.
    await addVisit({ date: FRI, tech: otherTechId, started: `${FRI}T14:00:00Z`, completed: `${FRI}T16:30:00Z` });
  });

  afterAll(async () => {
    for (const org of [orgId, otherOrgId]) {
      if (!org) continue;
      await admin`delete from time_entries where org_id = ${org}`;
      await admin`delete from job_visits where org_id = ${org}`;
      await admin`delete from orgs where id = ${org}`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  const read = (only?: string) =>
    withTenant(asOrgId(orgId), (tx) =>
      new DrizzleUnreportedDaysReader(tx, asOrgId(orgId)).find(MON, SUN, only ? asUserId(only) : undefined),
    );

  it("finds the day he worked and never reported, and counts the visits", async () => {
    const monday = (await read()).find((d) => d.date === MON && d.userId === techId);
    expect(monday).toBeDefined();
    expect(monday?.visits).toBe(2);
  });

  it("suggests first-to-last activity, so the offer is his own stamps and not an invention", async () => {
    const monday = (await read()).find((d) => d.date === MON);
    // Recorded 15:04→18:32 and 19:00→20:00; the day spans the outermost pair.
    //
    // INSTANTS, not "15:04". Rendering these in SQL put them in the database's timezone, so the card
    // offered a California technician "Add 4:05a–4:56a" for a day he worked nine to five — and that
    // button WRITES hours. The device converts now, because it is the only one that knows his clock.
    expect(monday?.firstStampAt).toBe(`${MON}T15:04:00.000Z`);
    expect(monday?.lastStampAt).toBe(`${MON}T20:00:00.000Z`);
  });

  it("says nothing about a day he already reported — ANY entry clears it", async () => {
    expect((await read()).map((d) => d.date)).not.toContain(TUE);
  });

  /**
   * The false positive that would have made the whole feature noise: every technician has future
   * bookings, every morning, and none of them owe hours for work they have not done yet.
   */
  it("says nothing about a visit nobody has been to yet", async () => {
    expect((await read()).map((d) => d.date)).not.toContain(WED);
  });

  it("says nothing about a canceled visit", async () => {
    expect((await read()).map((d) => d.date)).not.toContain(THU);
  });

  it("never sees another shop's crew", async () => {
    const rows = await read();
    expect(rows.every((d) => d.userId === techId || d.userId === otherTechId)).toBe(true);
  });

  it("answers for the whole crew, and scopes to one person when asked", async () => {
    const all = await read();
    expect(new Set(all.map((d) => d.userId)).size).toBe(2);

    const mine = await read(techId);
    expect(mine.every((d) => d.userId === techId)).toBe(true);
    expect(mine.length).toBeGreaterThan(0);
  });
});
