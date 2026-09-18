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

/** Server-side sort, search, count and keyset paging on the customers list. Every paging test
 *  crosses a boundary on purpose — that is where a broken cursor shows itself. */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = { authenticate: async () => { throw new Error("unused"); } };
const ctxFor = (orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role },
  unmapped: null, tx: null,
  deps: {
    authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator,
    paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null, llmClient: null,
    apiKeyAuthenticator: { authenticate: async () => null },
    tokenVerifier: { verify: async () => null },
    signupStore: { createOrgForUser: async () => { throw new Error("unused"); } },
  },
});

suite("customers list — server-side sort, search, count", () => {
  let admin: Sql;
  let orgId = "";
  const NAMES = ["Abbott", "Brennan", "Chen", "Delgado", "Ellis", "Ferraro", "Gomez"];

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('LeadSort ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    for (const [i, n] of NAMES.entries()) {
      await admin`
        insert into leads (org_id, name, email, phone_e164, address, value_cents, stage)
        values (${orgId}, ${n}, ${n.toLowerCase() + "@example.com"},
                ${"+1925555" + String(1000 + i)}, ${i + " Oak Grove Rd"}, ${(i + 1) * 25000}, 'new')`;
    }
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  const walkAll = async (args: Record<string, unknown>) => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let g = 0; g < 20; g++) {
      const page = await caller.v1.customers.list({ ...args, limit: 3, cursor } as never);
      ids.push(...page.items.map((l) => l.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    return ids;
  };

  it("sorts by name A-Z and pages without repeating or skipping", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const first = await caller.v1.customers.list({ sort: "name", limit: 3 });
    expect(first.items.map((l) => l.name)).toEqual(["Abbott", "Brennan", "Chen"]);
    const ids = await walkAll({ sort: "name" });
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(NAMES.length);
  });

  it("sorts by created across a page boundary", async () => {
    // Replaces a `value` sort removed alongside the Value column: it ordered by leads.value_cents,
    // a field nothing writes, under a column showing an estimate-derived number. They never agreed.
    const ids = await walkAll({ sort: "created", sortDir: "desc" });
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(NAMES.length);
  });

  it("defaults to last activity, not creation order", async () => {
    // An imported book has the same created_at on every row, which makes created a useless
    // ordering exactly when the list is biggest. lastActivity is what a shop actually scans.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const [target] = await admin<{ id: string }[]>`
      update leads set updated_at = now() + interval '1 day'
      where org_id = ${orgId} and name = 'Delgado' returning id`;
    const page = await caller.v1.customers.list({ sort: "lastActivity", limit: 1 });
    expect(page.items[0]!.id).toBe(target!.id);
  });

  it("searches name, email, phone and address in the database", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    expect((await caller.v1.customers.list({ search: "Chen", limit: 50 })).items).toHaveLength(1);
    expect((await caller.v1.customers.list({ search: "ferraro@example", limit: 50 })).items).toHaveLength(1);
    expect((await caller.v1.customers.list({ search: "9255551003", limit: 50 })).items).toHaveLength(1);
    expect((await caller.v1.customers.list({ search: "Oak Grove", limit: 50 })).items).toHaveLength(7);
  });

  it("treats a LIKE wildcard as text", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    expect((await caller.v1.customers.list({ search: "%", limit: 50 })).items).toHaveLength(0);
  });

  it("count reports the true total and honours the same filters", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const page = await caller.v1.customers.list({ sort: "name", limit: 3 });
    expect(page.items).toHaveLength(3);
    expect((await caller.v1.customers.count({})).total).toBe(7);
    const searched = await caller.v1.customers.list({ search: "Chen", limit: 50 });
    expect((await caller.v1.customers.count({ search: "Chen" })).total).toBe(searched.items.length);
  });

  it("keeps the default ordering when no sort is given", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    expect((await caller.v1.customers.list({ limit: 50 })).items).toHaveLength(7);
  });

  it("pages MICROSECOND timestamps without repeating a row", async () => {
    // Postgres timestamptz stores microseconds; a JS Date holds milliseconds. A cursor built from
    // a driver-returned Date is strictly LESS than its own row, so `col > cursor` matches that row
    // again and it reappears at the top of the next page.
    //
    // ASCENDING deliberately — the bug is directional. With `>` the row repeats; with `<` it
    // silently skips same-millisecond rows instead, which is real but far harder to trigger.
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('LeadMicro ' || gen_random_uuid()) returning id`;
    for (let i = 0; i < 7; i++) {
      await admin`
        insert into leads (org_id, name, updated_at)
        values (${o!.id}, ${"Micro " + i}, now() + (${i} || ' minutes')::interval)`;
    }
    const caller = appRouter.createCaller(ctxFor(o!.id, "owner"));
    const names: string[] = [];
    let cursor: string | null = null;
    for (let g = 0; g < 10; g++) {
      const page = await caller.v1.customers.list({ sort: "lastActivity", sortDir: "asc", limit: 3, cursor });
      names.push(...page.items.map((l) => l.name));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(names).toHaveLength(7);
    expect(new Set(names).size).toBe(7);
    await admin`delete from orgs where id = ${o!.id}`;
  });

  it("facets describe the BOOK, not a page", async () => {
    // The dropdown derived its options from the loaded collection, so on a book bigger than one
    // page it silently offered only the stages and sources present in the first 500 rows.
    await admin`update leads set stage = 'won' where org_id = ${orgId} and name = 'Abbott'`;
    await admin`update leads set source = 'Website form' where org_id = ${orgId} and name = 'Brennan'`;
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const f = await caller.v1.customers.facets();
    expect(f.stages.won).toBe(1);
    expect(f.stages.new).toBe(NAMES.length - 1);
    expect(f.sources.find((x) => x.source === "Website form")?.n).toBe(1);
  });

  it("filters by source", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const hits = await caller.v1.customers.list({ source: "Website form", limit: 50 });
    expect(hits.items).toHaveLength(1);
    expect((await caller.v1.customers.count({ source: "Website form" })).total).toBe(1);
  });

  it("does not leak across tenants", async () => {
    const [other] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('LeadSort Other ' || gen_random_uuid()) returning id`;
    const caller = appRouter.createCaller(ctxFor(other!.id, "owner"));
    expect((await caller.v1.customers.list({ sort: "name", limit: 50 })).items).toHaveLength(0);
    expect((await caller.v1.customers.count({})).total).toBe(0);
    await admin`delete from orgs where id = ${other!.id}`;
  });
});
