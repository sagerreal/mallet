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

/** Server-side sort, search, count and keyset paging on the invoices list. */
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

suite("invoices list — server-side sort, search, count", () => {
  let admin: Sql;
  let orgId = "";
  let leadId = "";
  // Due dates 5 days apart, oldest first. INV-0 is the most overdue — the top of a collection queue.
  const DUE_DAYS = [-30, -20, -10, 0, 10, 20, 30];

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('InvSort ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const [l] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Ortiz Plumbing') returning id`;
    leadId = l!.id;
    for (const [i, d] of DUE_DAYS.entries()) {
      await admin`
        insert into invoices (org_id, lead_id, num, title, status, total_cents, due_at)
        values (${orgId}, ${leadId}, ${"INV-" + i}, ${"Water heater " + i},
                ${i % 3 === 0 ? "paid" : "sent"}, ${(i + 1) * 15000},
                now() + (${d} || ' days')::interval)`;
    }
    // One draft with no due date — it must sort LAST, not first.
    await admin`
      insert into invoices (org_id, lead_id, num, title, status, total_cents, due_at)
      values (${orgId}, ${leadId}, 'INV-DRAFT', 'Not yet sent', 'draft', 9900, null)`;
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
      const page = await caller.v1.invoicing.list({ ...args, limit: 3, cursor } as never);
      ids.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    return ids;
  };

  it("defaults to the COLLECTION order — oldest owed first", async () => {
    // The point of an invoice list is getting money in, and money is collected oldest-first.
    // Newest-first, the obvious default, actively buries the bills that matter.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const page = await caller.v1.invoicing.list({ sort: "oldestUnpaid", limit: 3 });
    expect(page.items.map((i) => i.num)).toEqual(["INV-0", "INV-1", "INV-2"]);
  });

  it("sorts an undated draft LAST, not first", async () => {
    // due_at NULL under a DESC default would float to the top — Postgres sorts NULLS FIRST for
    // DESC — putting an unsent draft above genuinely overdue money.
    const ids = await walkAll({ sort: "oldestUnpaid" });
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const all = await caller.v1.invoicing.list({ sort: "oldestUnpaid", limit: 50 });
    expect(all.items[all.items.length - 1]!.num).toBe("INV-DRAFT");
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(8);
  });

  it("pages by amount without repeating or skipping", async () => {
    const ids = await walkAll({ sort: "amount", sortDir: "desc" });
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(8);
  });

  it("unpaidOnly narrows to money still owed", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const owed = await caller.v1.invoicing.list({ unpaidOnly: true, limit: 50 });
    expect(owed.items.length).toBeGreaterThan(0);
    for (const i of owed.items) expect(i.status).not.toBe("paid");
  });

  it("searches number, title and CUSTOMER name", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    expect((await caller.v1.invoicing.list({ search: "INV-3", limit: 50 })).items).toHaveLength(1);
    expect((await caller.v1.invoicing.list({ search: "Not yet", limit: 50 })).items).toHaveLength(1);
    expect((await caller.v1.invoicing.list({ search: "Ortiz", limit: 50 })).items).toHaveLength(8);
  });

  it("treats a LIKE wildcard as text", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    expect((await caller.v1.invoicing.list({ search: "%", limit: 50 })).items).toHaveLength(0);
  });

  it("count reports the true total and agrees with the list under a filter", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    expect((await caller.v1.invoicing.count({})).total).toBe(8);
    const owed = await caller.v1.invoicing.list({ unpaidOnly: true, limit: 50 });
    expect((await caller.v1.invoicing.count({ unpaidOnly: true })).total).toBe(owed.items.length);
  });

  it("keeps the default ordering when no sort is given", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    expect((await caller.v1.invoicing.list({ limit: 50 })).items).toHaveLength(8);
  });

  it("does not leak across tenants", async () => {
    const [other] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('InvSort Other ' || gen_random_uuid()) returning id`;
    const caller = appRouter.createCaller(ctxFor(other!.id, "owner"));
    expect((await caller.v1.invoicing.list({ sort: "oldestUnpaid", limit: 50 })).items).toHaveLength(0);
    expect((await caller.v1.invoicing.count({})).total).toBe(0);
    await admin`delete from orgs where id = ${other!.id}`;
  });
});
