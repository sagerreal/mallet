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

/**
 * Timezone was unreachable. The column exists, the domain validates it, the DTO returns it — but
 * updateConfigInput had no key for it, so no UI could ever set it and every org stayed on
 * America/Los_Angeles. The front desk and the in-app agent both read it.
 */
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
  deps: { authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator, paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null, llmClient: null, apiKeyAuthenticator: { authenticate: async () => null }, tokenVerifier: { verify: async () => null }, signupStore: { createOrgForUser: async () => { throw new Error("unused in this test"); } } },
});

suite("org timezone (live DB)", () => {
  let admin: Sql;
  let orgId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('Timezone ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("can be set and read back", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    await caller.v1.settings.updateConfig({ timezone: "America/New_York" });
    expect((await caller.v1.settings.get()).config.timezone).toBe("America/New_York");
  });

  it("refuses a timezone the runtime does not know, rather than storing it", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    await expect(
      caller.v1.settings.updateConfig({ timezone: "Mars/Olympus_Mons" }),
    ).rejects.toThrow();
  });

  it("leaves the timezone alone when the patch does not mention it", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    await caller.v1.settings.updateConfig({ timezone: "America/Denver" });
    await caller.v1.settings.updateConfig({ markupBps: 4000 });
    expect((await caller.v1.settings.get()).config.timezone).toBe("America/Denver");
  });
});
