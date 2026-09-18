import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { asOrgId, asUserId, type OrgId } from "@mallet/shared/types";
import { DrizzleTimeEntryRepository } from "./drizzle-time-entry-repository";

const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const NOW = new Date("2026-07-24T12:00:00.000Z");
const DAY = "2026-07-21";
const OTHER_DAY = "2026-07-22";
const WEEK = [DAY, OTHER_DAY];

// The bug this suite pins, verified against real Postgres:
//
// The office client optimistically skipped running entries when approving a week
// (lib/store/slices/timesheets-slice.ts filters `!e.running`), but the SQL predicate had no such
// condition — so the DATABASE approved them anyway. Store and database disagreed. The approved-but-
// endless entry was then pushed to QuickBooks, rejected as `entry_not_finished`, and those hours
// disappeared with no error surfacing anywhere.
suite("approveWeek must not swallow unfinished hours (live)", () => {
  let admin: Sql;
  let orgId = "";
  let techId = "";

  const mk = async (
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    over: { workDate?: string; endTime?: string | null; running?: boolean } = {},
  ) => {
    const repo = new DrizzleTimeEntryRepository(tx, asOrgId(orgId));
    return repo.create({
      id: crypto.randomUUID(),
      orgId,
      techUserId: techId,
      jobId: null,
      workDate: over.workDate ?? DAY,
      kind: "job",
      startTime: "08:00",
      endTime: over.endTime === undefined ? "16:00" : over.endTime,
      minutes: null,
      note: "",
      src: "clock",
      status: "draft",
      running: over.running ?? false,
      editedByUserId: null,
    });
  };

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('ApproveUnfinished ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const [u] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgId}, gen_random_uuid(), 'tech@unfinished.test', 'tech', true) returning id`;
    techId = u!.id;
  });

  afterAll(async () => {
    if (orgId) {
      await admin`delete from time_entries where org_id = ${orgId}`;
      await admin`delete from users where org_id = ${orgId}`;
      await admin`delete from orgs where id = ${orgId}`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  const clearEntries = async () => {
    await admin`delete from time_entries where org_id = ${orgId}`;
  };

  it("reports a running entry's day as unfinished", async () => {
    await clearEntries();
    const ORG: OrgId = asOrgId(orgId);
    const found = await withTenant(ORG, async (tx) => {
      await mk(tx, { running: true, endTime: null });
      return new DrizzleTimeEntryRepository(tx, ORG).unfinishedDates(asUserId(techId), WEEK);
    });
    expect(found).toEqual([DAY]);
  });

  it("reports an end-less entry as unfinished even when the running flag is false", async () => {
    await clearEntries();
    const ORG: OrgId = asOrgId(orgId);
    const found = await withTenant(ORG, async (tx) => {
      await mk(tx, { running: false, endTime: null });
      return new DrizzleTimeEntryRepository(tx, ORG).unfinishedDates(asUserId(techId), WEEK);
    });
    expect(found).toEqual([DAY]);
  });

  it("reports nothing unfinished for a clean week", async () => {
    await clearEntries();
    const ORG: OrgId = asOrgId(orgId);
    const found = await withTenant(ORG, async (tx) => {
      await mk(tx);
      await mk(tx, { workDate: OTHER_DAY });
      return new DrizzleTimeEntryRepository(tx, ORG).unfinishedDates(asUserId(techId), WEEK);
    });
    expect(found).toEqual([]);
  });

  // The core regression: even a direct repository call must not approve an endless entry.
  it("REFUSES to approve a running entry, even called directly", async () => {
    await clearEntries();
    const ORG: OrgId = asOrgId(orgId);
    const approved = await withTenant(ORG, async (tx) => {
      await mk(tx, { running: true, endTime: null });
      return new DrizzleTimeEntryRepository(tx, ORG).approveWeek(asUserId(techId), WEEK, NOW);
    });
    expect(approved).toBe(0);

    const rows = await admin<{ status: string }[]>`
      select status from time_entries where org_id = ${orgId}`;
    expect(rows.map((r) => r.status)).toEqual(["draft"]);
  });

  it("approves the finished entries in a clean week", async () => {
    await clearEntries();
    const ORG: OrgId = asOrgId(orgId);
    const approved = await withTenant(ORG, async (tx) => {
      await mk(tx);
      await mk(tx, { workDate: OTHER_DAY });
      return new DrizzleTimeEntryRepository(tx, ORG).approveWeek(asUserId(techId), WEEK, NOW);
    });
    expect(approved).toBe(2);
  });

  it("leaves an unfinished entry as draft while approving its finished sibling", async () => {
    await clearEntries();
    const ORG: OrgId = asOrgId(orgId);
    await withTenant(ORG, async (tx) => {
      await mk(tx);
      await mk(tx, { running: true, endTime: null });
      await new DrizzleTimeEntryRepository(tx, ORG).approveWeek(asUserId(techId), WEEK, NOW);
    });

    const rows = await admin<{ status: string; running: boolean }[]>`
      select status, running from time_entries where org_id = ${orgId} order by running`;
    expect(rows).toEqual([
      { status: "approved", running: false },
      { status: "draft", running: true },
    ]);
  });
});
