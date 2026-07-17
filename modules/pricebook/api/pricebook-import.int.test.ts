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

// Capstone: exercise `v1.pricebook.importServices` via createCaller — auth gate, RBAC,
// org-scoped transaction, category find-or-create, use-case, Drizzle repo, and live RLS —
// without spinning up HTTP. Proves the category-cache contract (a repeated category name in
// one batch is created once and reused, not once per row), the per-row created/deduped/failed
// classification, and tenant isolation.
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

suite("pricebook tRPC router — CSV import (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('PricebookImportApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('PricebookImportApi B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("creates a new category once and reuses it, allows a null category, and dedupes a repeated name", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const suffix = randomUUID().slice(0, 8);
    const heaterName = `Tankless Water Heater Install ${suffix}`;
    const flushName = `Water Heater Flush ${suffix}`;
    const faucetName = `Faucet Repair ${suffix}`;

    const result = await caller.v1.pricebook.importServices({
      rows: [
        // (a) new service in a NEW category "Water Heaters".
        {
          name: heaterName,
          category: "Water Heaters",
          description: "40-gal tankless swap",
          code: "WH-001",
          unitPriceCents: 249900,
          costCents: 90000,
          taxable: true,
        },
        // (b) another service in the SAME new category — must reuse the id, not create a 2nd.
        {
          name: flushName,
          category: "Water Heaters",
          description: null,
          code: null,
          unitPriceCents: 15000,
          costCents: 2000,
          taxable: false,
        },
        // (c) a service with a null category.
        {
          name: faucetName,
          category: null,
          description: null,
          code: null,
          unitPriceCents: 12000,
          costCents: 1500,
          taxable: false,
        },
        // (d) a duplicate of (a)'s name — same org, same case — must dedupe, not create.
        {
          name: heaterName,
          category: "Water Heaters",
          description: null,
          code: null,
          unitPriceCents: 249900,
          costCents: 90000,
          taxable: true,
        },
      ],
    });

    expect(result.created).toBe(3);
    expect(result.deduped).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);

    // Exactly one "Water Heaters" category exists for this org — the batch cache prevented a
    // second create when row (b) hit the same category name as row (a).
    const categories = await caller.v1.pricebook.category.list();
    const waterHeaterCategories = categories.filter((c) => c.name === "Water Heaters");
    expect(waterHeaterCategories).toHaveLength(1);
    const categoryId = waterHeaterCategories[0]!.id;

    const services = await caller.v1.pricebook.service.list({ limit: 500, search: suffix });
    const heater = services.items.find((s) => s.name === heaterName);
    const flush = services.items.find((s) => s.name === flushName);
    const faucet = services.items.find((s) => s.name === faucetName);

    expect(heater).toBeDefined();
    expect(flush).toBeDefined();
    expect(faucet).toBeDefined();
    expect(heater!.categoryId).toBe(categoryId);
    expect(flush!.categoryId).toBe(categoryId);
    expect(faucet!.categoryId).toBeNull();

    // The duplicate row did not produce a second row with the same name.
    expect(services.items.filter((s) => s.name === heaterName)).toHaveLength(1);
  });

  it("tenant isolation: importing into org A creates nothing visible to org B", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const suffix = randomUUID().slice(0, 8);
    const serviceName = `Org A Isolated Import Service ${suffix}`;
    const categoryName = `Org A Isolated Category ${suffix}`;

    const result = await callerA.v1.pricebook.importServices({
      rows: [
        {
          name: serviceName,
          category: categoryName,
          description: null,
          code: null,
          unitPriceCents: 5000,
          costCents: 1000,
          taxable: false,
        },
      ],
    });
    expect(result.created).toBe(1);

    const servicesB = await callerB.v1.pricebook.service.list({ limit: 500 });
    expect(servicesB.items.some((s) => s.name === serviceName)).toBe(false);

    const categoriesB = await callerB.v1.pricebook.category.list();
    expect(categoriesB.some((c) => c.name === categoryName)).toBe(false);
  });

  it("a tech is forbidden from importing services", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(
      callerTech.v1.pricebook.importServices({
        rows: [
          {
            name: "Nope",
            category: null,
            description: null,
            code: null,
            unitPriceCents: 0,
            costCents: 0,
            taxable: false,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
