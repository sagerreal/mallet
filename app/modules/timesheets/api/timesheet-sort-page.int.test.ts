import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { AuthProvider, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

/**
 * Paging the time-entry list.
 *
 * THE BUG THIS LOCKS DOWN. The list ordered by (work_date, created_at, id) but its cursor encoded
 * only (created_at, id). Wherever those two orders disagree across a page boundary, a row is
 * skipped or repeated — and they disagree the moment anyone back-dates a correction, which is the
 * single most common edit a shop makes to a timesheet. An entry silently missing from a page is
 * hours missing from payroll.
 *
 * The fixture below is built so the two orders disagree on purpose: entries are INSERTED in one
 * order (so created_at ascends that way) and carry work dates in the opposite order.
 */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = { authenticate: async () => { throw new Error("unused"); } };
const ctxFor = (orgId: string, userId: string, role: Role): Context => ({
  principal: { userId: asUserId(userId), orgId: asOrgId(orgId), role },
  unmapped: null,
  tx: null,
  deps: {
    authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator,
    paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null, llmClient: null,
    apiKeyAuthenticator: { authenticate: async () => null },
    tokenVerifier: { verify: async () => null },
    signupStore: { createOrgForUser: async () => { throw new Error("unused"); } },
  },
});

suite("time entries — sort and keyset paging", () => {
  let admin: Sql;
  let orgId = "";
  let ownerId = "";
  let techA = "";
  let techB = "";

  // Inserted LAST-DAY-FIRST: created_at ascends 09-14 → 09-08, work_date descends. Any cursor
  // keyed on created_at while ordering by work_date will lose rows here.
  const DAYS = ["2026-09-14", "2026-09-13", "2026-09-12", "2026-09-11", "2026-09-10", "2026-09-09", "2026-09-08"];

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('TsSort ' || gen_random_uuid()) returning id`;
    orgId = o!.id;

    const mkUser = async (name: string, role: string) => {
      const [u] = await admin<{ id: string }[]>`
        insert into users (org_id, auth_user_id, name, email, role)
        values (${orgId}, ${randomUUID()}, ${name}, ${`${randomUUID()}@example.test`}, ${role})
        returning id`;
      return u!.id;
    };
    ownerId = await mkUser("Owner", "owner");
    techA = await mkUser("Tech A", "tech");
    techB = await mkUser("Tech B", "tech");

    for (const [i, day] of DAYS.entries()) {
      for (const tech of [techA, techB]) {
        await admin`
          insert into time_entries (org_id, tech_user_id, work_date, kind, start_time, end_time, src, status, running)
          values (${orgId}, ${tech}, ${day}, 'job', '08:00', '16:00', 'manual', 'draft', false)`;
      }
      void i;
    }
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  /** Walk every page at a limit small enough that boundaries fall inside a day's entries. */
  const walkAll = async (args: Record<string, unknown> = {}) => {
    const caller = appRouter.createCaller(ctxFor(orgId, ownerId, "owner"));
    const rows: { id: string; workDate: string; techUserId: string }[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 40; guard++) {
      const page = await caller.v1.timesheets.list({ ...args, limit: 3, cursor } as never);
      rows.push(...page.items.map((e) => ({ id: e.id, workDate: e.workDate, techUserId: e.techUserId })));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    return rows;
  };

  it("pages the whole list without skipping or repeating an entry", async () => {
    const rows = await walkAll();
    expect(rows.length).toBe(DAYS.length * 2);                 // nothing skipped
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length); // nothing repeated
  });

  it("orders by work date ascending — a week is read forwards, not newest-first", async () => {
    const dates = (await walkAll()).map((r) => r.workDate);
    expect(dates[0]).toBe("2026-09-08");
    expect(dates[dates.length - 1]).toBe("2026-09-14");
    expect([...dates].sort()).toEqual(dates);
  });

  // The exact disagreement the old cursor could not survive: insertion order is the reverse of
  // work-date order, so a cursor keyed on created_at resumes in the wrong place.
  it("survives work-date order disagreeing with insertion order", async () => {
    const rows = await walkAll();
    const byDay = new Map<string, number>();
    for (const r of rows) byDay.set(r.workDate, (byDay.get(r.workDate) ?? 0) + 1);
    for (const day of DAYS) {
      expect(byDay.get(day), `${day} lost an entry across a page boundary`).toBe(2);
    }
  });

  it("sorts by technician, keeping one person's hours together", async () => {
    const techs = (await walkAll({ sort: "tech" })).map((r) => r.techUserId);
    const runs = techs.filter((t, i) => t !== techs[i - 1]);
    expect(new Set(runs).size).toBe(runs.length);
  });

  it("reverses the date order on request", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, ownerId, "owner"));
    const page = await caller.v1.timesheets.list({ sort: "date", sortDir: "desc", limit: 20 });
    expect(page.items[0]?.workDate).toBe("2026-09-14");
  });

  it("counts the same set it lists", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, ownerId, "owner"));
    const { total } = await caller.v1.timesheets.count({});
    expect(total).toBe(DAYS.length * 2);
  });

  it("scopes a range to the days asked for — the week the office panel is showing", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, ownerId, "owner"));
    const page = await caller.v1.timesheets.list({ fromDate: "2026-09-09", toDate: "2026-09-11", limit: 50 });
    expect(new Set(page.items.map((e) => e.workDate))).toEqual(new Set(["2026-09-09", "2026-09-10", "2026-09-11"]));
  });
});
