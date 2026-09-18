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
 * Sorting jobs by CUSTOMER — the one sort that crosses tables.
 *
 * jobs → leads is many-to-ONE, so joining leads returns exactly one row per job and the keyset is
 * undisturbed. That is the claim, and a claim about row multiplication is only worth anything when
 * it is demonstrated on a customer holding MORE THAN ONE job, and across a page boundary: a keyset
 * bug is invisible on page one, which is the only page anyone checks by hand.
 *
 * Its own org, because these fixtures would change the totals every other sort test asserts.
 */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = { authenticate: async () => { throw new Error("unused"); } };
const ctxFor = (orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role },
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

suite("jobs list — sort by customer", () => {
  let admin: Sql;
  let orgId = "";

  // Deliberately NOT in alphabetical order of insertion, so passing would be a coincidence.
  // Mendez holds three jobs — the row-multiplication case.
  const BOOK: readonly (readonly [string, number])[] = [
    ["Mendez, Lou", 3],
    ["Abbott, Ray", 1],
    ["Zimmer, Kay", 1],
    ["Nakamura, Ito", 2],
    ["Baptiste, Xiu", 2],
  ];
  const TOTAL_JOBS = BOOK.reduce((n, [, c]) => n + c, 0); // 9

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('SortCust ' || gen_random_uuid()) returning id`;
    orgId = o!.id;

    for (const [name, count] of BOOK) {
      const [l] = await admin<{ id: string }[]>`
        insert into leads (org_id, name) values (${orgId}, ${name}) returning id`;
      for (let i = 0; i < count; i++) {
        await admin`
          insert into jobs (org_id, lead_id, num, title, status, total_cents)
          values (${orgId}, ${l!.id}, ${`JC-${name.slice(0, 3)}-${i}`}, 'Service call', 'scheduled', 7500)`;
      }
    }
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  /** Walk every page at a small limit, so the boundaries land inside a customer's run of jobs. */
  const walkAll = async (sortDir: "asc" | "desc") => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const rows: { id: string; customerName: string | null }[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard++) {
      const page = await caller.v1.jobs.list({ sort: "customer", sortDir, limit: 2, cursor } as never);
      rows.push(...page.items.map((j) => ({ id: j.id, customerName: j.customerName })));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    return rows;
  };

  it("returns every job exactly once — the join does not multiply rows", async () => {
    const rows = await walkAll("asc");
    expect(rows.length).toBe(TOTAL_JOBS);
    expect(new Set(rows.map((r) => r.id)).size).toBe(TOTAL_JOBS);
  });

  it("orders alphabetically by customer, across page boundaries", async () => {
    const names = (await walkAll("asc")).map((r) => r.customerName);
    expect(names[0]).toBe("Abbott, Ray");
    expect(names[names.length - 1]).toBe("Zimmer, Kay");
    expect([...names].sort()).toEqual(names); // already in order
  });

  it("keeps one customer's jobs together instead of scattering them", async () => {
    // The tiebreaker is the job id, so a customer's run must be contiguous. Scattered rows mean
    // the cursor is resuming on the wrong key.
    const names = (await walkAll("asc")).map((r) => r.customerName);
    const runs = names.filter((n, i) => n !== names[i - 1]);
    expect(new Set(runs).size).toBe(runs.length);
  });

  it("reverses cleanly — a sort nobody can reverse is half a sort", async () => {
    const names = (await walkAll("desc")).map((r) => r.customerName);
    expect(names[0]).toBe("Zimmer, Kay");
    expect(names[names.length - 1]).toBe("Abbott, Ray");
  });

  it("counts the same set it lists", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const { total } = await caller.v1.jobs.count({});
    expect(total).toBe(TOTAL_JOBS);
  });
});
