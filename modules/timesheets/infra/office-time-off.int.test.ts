import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { asOrgId, asUserId, asTimeEntryId } from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { DrizzleTimeEntryRepository } from "./drizzle-time-entry-repository";
import { UpdateTimeEntryUseCase } from "../app/update-time-entry";
import { tsKindChange } from "@/features/jobs/timesheet-derive";
import type { TimeEntry } from "@/lib/store/types";

/**
 * The office turning a worked row into a day off, all the way to the database.
 *
 * WHY THIS NEEDS THE LIVE DB. `time_entries_kind_shape_check` makes the two shapes mutually
 * exclusive: a clocked row has a start and no minutes, a day off has minutes and NO punch times.
 * The client can compute a perfectly sensible patch and still be refused by that constraint, and the
 * only place that shows up is Postgres. A unit test asserting the patch's shape proves the intent;
 * this proves the write.
 *
 * It also feeds the REAL client rule (`tsKindChange`) into the REAL use-case, so the two cannot drift:
 * if someone loosens the client conversion, this fails here rather than in production on a shop that
 * cannot record a holiday.
 */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

/** The store's view of a row, which is what the office's conversion rule takes. */
const asStoreEntry = (over: Partial<TimeEntry>): TimeEntry => ({
  id: "x",
  techId: "t",
  date: "2026-07-24",
  kind: "shop",
  jobId: null,
  start: "08:00",
  end: "16:00",
  minutes: null,
  note: "",
  src: "manual",
  status: "draft",
  running: false,
  ...over,
});

suite("the office records time off (live DB)", () => {
  let admin: Sql;
  let orgId = "";
  let techId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('OfficePTO ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const [u] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgId}, gen_random_uuid(), 'pto-' || gen_random_uuid() || '@office.test', 'tech', true)
      returning id`;
    techId = u!.id;
  });

  afterAll(async () => {
    if (orgId) {
      await admin`delete from time_entries where org_id = ${orgId}`;
      await admin`delete from orgs where id = ${orgId}`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  /** A committed worked row, as the clock would have written it. */
  const seedWorked = async (): Promise<string> => {
    const id = crypto.randomUUID();
    await admin`
      insert into time_entries (id, org_id, tech_user_id, work_date, kind, start_time, end_time, src, status)
      values (${id}, ${orgId}, ${techId}, '2026-07-24', 'shop', '08:00', '16:00', 'manual', 'draft')`;
    return id;
  };

  const applyPatch = (id: string, patch: Partial<TimeEntry>) =>
    withTenant(asOrgId(orgId), async (tx) => {
      const repo = new DrizzleTimeEntryRepository(tx, asOrgId(orgId));
      const clock = { now: () => new Date("2026-07-24T18:00:00Z") };
      return new UpdateTimeEntryUseCase(repo, clock).exec(
        {
          entryId: asTimeEntryId(id),
          kind: patch.kind as never,
          startTime: patch.start,
          endTime: patch.end,
          minutes: patch.minutes,
          running: patch.running,
          editedBy: asUserId(techId),
        },
        orgId,
      );
    });

  const rowOf = async (id: string) => {
    const [row] = await admin<
      { kind: string; start_time: string | null; end_time: string | null; minutes: number | null; running: boolean }[]
    >`select kind, start_time, end_time, minutes, running from time_entries where id = ${id}`;
    return row;
  };

  it("stores a holiday as a LENGTH with no punch times, using the office's own conversion rule", async () => {
    const id = await seedWorked();
    const patch = tsKindChange(asStoreEntry({ id }), "holiday");

    const result = await applyPatch(id, patch);
    expect(result.ok, `the write was refused: ${result.ok ? "" : JSON.stringify(result.error)}`).toBe(true);

    const row = await rowOf(id);
    expect(row?.kind).toBe("holiday");
    expect(row?.start_time).toBeNull();
    expect(row?.end_time).toBeNull();
    expect(row?.minutes).toBe(480);
    expect(row?.running).toBe(false);
  });

  it("turns a day off back into worked time with real punch times", async () => {
    const id = await seedWorked();
    const toOff = await applyPatch(id, tsKindChange(asStoreEntry({ id }), "pto"));
    expect(toOff.ok).toBe(true);

    const asOff = asStoreEntry({ id, kind: "pto", start: null, end: null, minutes: 480 });
    const back = await applyPatch(id, tsKindChange(asOff, "shop"));
    expect(back.ok, `the write back was refused: ${back.ok ? "" : JSON.stringify(back.error)}`).toBe(true);

    const row = await rowOf(id);
    expect(row?.kind).toBe("shop");
    expect(row?.minutes).toBeNull();
    expect(row?.start_time).toBe("08:00:00");
  });

  it("REFUSES the naive patch — proving the constraint is real and the rule is what satisfies it", async () => {
    // Sending kind alone is what the code did before `tsKindChange`: the old shape's columns stay
    // populated and Postgres rejects the row. If this ever starts passing, the constraint has been
    // weakened and the two shapes can coexist in one row.
    const id = await seedWorked();
    const result = await applyPatch(id, { kind: "holiday" });
    expect(result.ok).toBe(false);
  });
});
