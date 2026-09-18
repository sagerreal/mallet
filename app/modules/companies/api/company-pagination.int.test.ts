import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { AuthProvider, Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

// Regression test for the page-2 crash: postgres.js cannot bind a JS Date inside a keyset
// row-value tuple, so any list with more rows than one page threw on the *second* page (see
// shared/db/keyset.ts). This creates more companies than one page holds, walks every page via
// the returned nextCursor, and asserts every created row shows up exactly once — proving both
// that page 2 no longer crashes and that the keyset comparison doesn't skip or duplicate rows.
// Companies is the clean case: it orders purely by (created_at desc, id desc), which matches
// its cursor exactly (unlike tasks/timesheets — see the NOTE at their keyset call sites).
//
// Kept in its own file (rather than a second `describe` in company-router.int.test.ts) because
// that file's afterAll calls closeDb() on the shared drizzle client — a second suite in the same
// module would inherit the now-closed pool. A separate file gets its own module instance.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

const ctxFor = (orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: {
    authProvider: stubAuth,
    bus: new InMemoryEventBus(),
    clock: systemClock,
    ids: uuidGenerator,
    paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null,
    llmClient: null,
    apiKeyAuthenticator: { authenticate: async () => null },
    tokenVerifier: { verify: async () => null },
    signupStore: {
      createOrgForUser: async () => {
        throw new Error("unused in this test");
      },
    },
  },
});

suite("companies keyset pagination (live RLS)", () => {
  let admin: Sql;
  let orgId = "";
  const pageLimit = 5;
  const totalCompanies = 12;

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [org] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('CompanyApi Paging ' || gen_random_uuid()) returning id`;
    orgId = org!.id;
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("pages past page 1 without crashing, visiting every created company exactly once", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));

    // Sequential, not Promise.all: concurrent transactions here can exceed the pooler's
    // connection budget and drop one mid-query — unrelated to what this test is proving.
    const createdIds: string[] = [];
    for (let i = 0; i < totalCompanies; i++) {
      const company = await caller.v1.companies.create({ name: `Paging Co ${i}` });
      createdIds.push(company.id);
    }

    const seenIds: string[] = [];
    let cursor: string | null | undefined = undefined;
    let pages = 0;
    do {
      // The crash under test: page 1 (cursor undefined) always worked — it's this second
      // (and later) call, with a real cursor, that threw before the fix.
      const page = await caller.v1.companies.list({ limit: pageLimit, cursor });
      seenIds.push(...page.items.map((c) => c.id));
      cursor = page.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(20); // guard against an infinite-loop regression
    } while (cursor);

    expect(pages).toBeGreaterThan(1); // proves we actually paged past page 1

    const createdSeen = seenIds.filter((id) => createdIds.includes(id));
    expect(createdSeen).toHaveLength(totalCompanies); // no skips
    expect(new Set(createdSeen).size).toBe(totalCompanies); // no duplicates
    expect(new Set(seenIds).size).toBe(seenIds.length); // no duplicates anywhere in the walk
  });
});
