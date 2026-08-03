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

/**
 * The Active tab's filter — the one that did not exist.
 *
 * "Active" left the view null and the repository filtered nothing but deleted_at, so the tab showed
 * finished and canceled work alongside open jobs and the header counted the whole book on BOTH
 * tabs — "50 of 1528" was the same number under both labels.
 *
 * Its own FILE, not a second suite alongside the sort tests: the sort suite closes the shared
 * connection pool in afterAll, and a suite sharing that process afterwards gets CONNECTION_ENDED.
 */
suite("jobs list — activeOnly", () => {
  let admin: Sql;
  let orgId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('ActiveOnly ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const [l] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Active Customer') returning id`;
    // scheduled_start stays NULL on every row, as every live create path leaves it. A canceled job
    // needs a reason or the domain mapper refuses to rebuild it ("a canceled job requires a
    // reason") — the fixture has to satisfy the invariant, not work around it.
    const mk = (num: string, status: string) => admin`
      insert into jobs (org_id, lead_id, num, title, status, total_cents, scheduled_start,
                        completed_at, canceled_at, cancel_reason)
      values (${orgId}, ${l!.id}, ${num}, 'Work', ${status}, 1000, null,
              ${status === "complete" ? admin`now()` : null},
              ${status === "canceled" ? admin`now()` : null},
              ${status === "canceled" ? "customer rescheduled" : null})`;
    await mk("A-OPEN-1", "scheduled");
    await mk("A-OPEN-2", "scheduled");
    await mk("A-OPEN-3", "in_progress");
    await mk("A-DONE-1", "complete");
    await mk("A-DONE-2", "complete");
    await mk("A-CANC-1", "canceled");
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("returns only open work when the list asks for it", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const all = await caller.v1.jobs.list({ limit: 50 });
    expect(all.items).toHaveLength(6);

    const active = await caller.v1.jobs.list({ activeOnly: true, limit: 50 });
    expect(active.items.map((j) => j.num).sort()).toEqual(["A-OPEN-1", "A-OPEN-2", "A-OPEN-3"]);
  });

  it("makes the HEADER TOTAL match the set on screen", async () => {
    // "50 of 1528" on a tab showing a filtered slice is a number describing a different question.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const active = await caller.v1.jobs.list({ activeOnly: true, limit: 50 });
    expect((await caller.v1.jobs.count({ activeOnly: true })).total).toBe(active.items.length);
    expect((await caller.v1.jobs.count({ activeOnly: true })).total).toBe(3);
    expect((await caller.v1.jobs.count({})).total).toBe(6);
  });

  it("counts a chosen VIEW rather than the whole book", async () => {
    // The count query used to send only `search`, so selecting Done still printed the book total.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const today = "2026-09-01";
    const done = await caller.v1.jobs.list({ view: "done", today, limit: 50 });
    expect((await caller.v1.jobs.count({ view: "done", today })).total).toBe(done.items.length);
    const needsSlot = await caller.v1.jobs.list({ view: "needsSlot", today, limit: 50 });
    expect((await caller.v1.jobs.count({ view: "needsSlot", today })).total).toBe(needsSlot.items.length);
    expect(needsSlot.items).toHaveLength(3); // the three open jobs, none of them placed
  });

  it("REJECTS a view sent without today rather than silently counting everything", async () => {
    // The repository drops a view whose `today` is missing, which returns the whole book wearing a
    // filtered label. A no-silent-failure boundary is the only place to catch that.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    await expect(caller.v1.jobs.count({ view: "done" } as never)).rejects.toThrow();
    await expect(caller.v1.jobs.list({ view: "done", limit: 50 } as never)).rejects.toThrow();
  });

  it("keeps activeOnly org-scoped", async () => {
    const [other] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('ActiveOnly Other ' || gen_random_uuid()) returning id`;
    const caller = appRouter.createCaller(ctxFor(other!.id, "owner"));
    expect((await caller.v1.jobs.list({ activeOnly: true, limit: 50 })).items).toHaveLength(0);
    expect((await caller.v1.jobs.count({ activeOnly: true })).total).toBe(0);
    await admin`delete from orgs where id = ${other!.id}`;
  });
});
