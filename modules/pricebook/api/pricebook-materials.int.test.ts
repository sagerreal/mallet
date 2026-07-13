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

// Capstone: exercise the pricebook material + service-material stack via createCaller — auth
// gate, RBAC, org-scoped transaction, use-case, Drizzle repo, and live RLS — without spinning up
// HTTP. Proves an owner can create/update/archive materials and attach/detach them to a service,
// a different org sees none of it (RLS), and org B cannot attach org A's material even to its own
// service (the composite FK / in-org existence check closes the cross-tenant hole).
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
    paymentLinkGateway: null, photoStorageGateway: null,
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

suite("pricebook tRPC router — materials (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('PricebookMaterialsApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('PricebookMaterialsApi B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  // ── material CRUD round-trip ─────────────────────────────────────────────────

  it("an owner creates a material and lists it back", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.pricebook.material.create({
      name: "Copper Pipe 1/2in",
      unitCostCents: 250,
      unitOfMeasure: "ft",
      markupBps: 3000,
      taxable: true,
    });
    expect(created.name).toBe("Copper Pipe 1/2in");
    expect(created.unitCostCents).toBe(250);
    expect(created.unitOfMeasure).toBe("ft");
    expect(created.markupBps).toBe(3000);
    expect(created.taxable).toBe(true);
    expect(created.active).toBe(true);
    expect(created.categoryId).toBeNull();

    const listed = await caller.v1.pricebook.material.list({ limit: 50 });
    expect(listed.items.some((m) => m.id === created.id)).toBe(true);
  });

  it("create with a client-authored id uses that id", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const myId = randomUUID();
    const created = await caller.v1.pricebook.material.create({
      id: myId,
      name: "Client ID Material",
      unitCostCents: 100,
    });
    expect(created.id).toBe(myId);
  });

  it("update happy path: name, cost, markup, active persist", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.pricebook.material.create({
      name: "Update Target Material",
      unitCostCents: 500,
    });

    const updated = await caller.v1.pricebook.material.update({
      materialId: created.id,
      name: "Updated Material",
      unitCostCents: 600,
      markupBps: 1500,
      active: false,
    });

    expect(updated.name).toBe("Updated Material");
    expect(updated.unitCostCents).toBe(600);
    expect(updated.markupBps).toBe(1500);
    expect(updated.active).toBe(false);
  });

  it("update on unknown materialId returns NOT_FOUND", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.pricebook.material.update({ materialId: randomUUID(), name: "Whatever" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("archive soft-deletes a material; it disappears from list", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.pricebook.material.create({
      name: "Archive Me Material",
      unitCostCents: 100,
    });

    const result = await caller.v1.pricebook.material.archive({ materialId: created.id });
    expect(result.ok).toBe(true);

    const listed = await caller.v1.pricebook.material.list({ limit: 500 });
    expect(listed.items.some((m) => m.id === created.id)).toBe(false);
  });

  it("archive on unknown materialId returns NOT_FOUND", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.pricebook.material.archive({ materialId: randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── attach / detach ───────────────────────────────────────────────────────────

  it("attaches a material to a service, listForService returns it, then detach removes it", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const service = await caller.v1.pricebook.service.create({
      name: "Water Heater Install (Materials Test)",
      unitPriceCents: 100000,
      costCents: 40000,
    });
    const material = await caller.v1.pricebook.material.create({
      name: "Water Heater Unit",
      unitCostCents: 35000,
    });

    const attached = await caller.v1.pricebook.serviceMaterial.attach({
      serviceId: service.id,
      materialId: material.id,
      quantity: 1,
    });
    expect(attached.ok).toBe(true);

    const listed = await caller.v1.pricebook.serviceMaterial.listForService({
      serviceId: service.id,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      serviceId: service.id,
      materialId: material.id,
      quantity: 1,
    });

    const detached = await caller.v1.pricebook.serviceMaterial.detach({
      serviceId: service.id,
      materialId: material.id,
    });
    expect(detached.ok).toBe(true);

    const listedAfterDetach = await caller.v1.pricebook.serviceMaterial.listForService({
      serviceId: service.id,
    });
    expect(listedAfterDetach).toHaveLength(0);
  });

  it("attach on an unknown service or material returns NOT_FOUND", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const service = await caller.v1.pricebook.service.create({
      name: "Attach NOT_FOUND Service",
      unitPriceCents: 100,
      costCents: 10,
    });
    const material = await caller.v1.pricebook.material.create({
      name: "Attach NOT_FOUND Material",
      unitCostCents: 100,
    });

    await expect(
      caller.v1.pricebook.serviceMaterial.attach({
        serviceId: randomUUID(),
        materialId: material.id,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      caller.v1.pricebook.serviceMaterial.attach({
        serviceId: service.id,
        materialId: randomUUID(),
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("detach on a not-attached pair returns NOT_FOUND", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const service = await caller.v1.pricebook.service.create({
      name: "Detach NOT_FOUND Service",
      unitPriceCents: 100,
      costCents: 10,
    });
    const material = await caller.v1.pricebook.material.create({
      name: "Detach NOT_FOUND Material",
      unitCostCents: 100,
    });

    await expect(
      caller.v1.pricebook.serviceMaterial.detach({
        serviceId: service.id,
        materialId: material.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── tenant isolation (RLS) ───────────────────────────────────────────────────

  it("a different org sees none of org A's materials", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const material = await callerA.v1.pricebook.material.create({
      name: "Org A Only Material",
      unitCostCents: 100,
    });

    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const listedMaterials = await callerB.v1.pricebook.material.list({ limit: 500 });
    expect(listedMaterials.items.some((m) => m.id === material.id)).toBe(false);
  });

  it("org B cannot update or archive org A's material (NOT_FOUND via RLS)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await callerA.v1.pricebook.material.create({
      name: "RLS Boundary Material",
      unitCostCents: 100,
    });

    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));

    await expect(
      callerB.v1.pricebook.material.update({ materialId: created.id, name: "Should fail" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      callerB.v1.pricebook.material.archive({ materialId: created.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("org B cannot attach org A's material to org B's own service", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const orgAMaterial = await callerA.v1.pricebook.material.create({
      name: "Org A Cross-Tenant Material",
      unitCostCents: 100,
    });

    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const orgBService = await callerB.v1.pricebook.service.create({
      name: "Org B Own Service",
      unitPriceCents: 100,
      costCents: 10,
    });

    // Org B's material repo is scoped to org B's tenant transaction, so org A's material id
    // resolves to nothing — the use-case's in-org existence check (backed by the composite FK
    // pricebook_service_materials_material_fk on (org_id, material_id)) rejects the cross-tenant
    // attach before any join row could be written.
    await expect(
      callerB.v1.pricebook.serviceMaterial.attach({
        serviceId: orgBService.id,
        materialId: orgAMaterial.id,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const listed = await callerB.v1.pricebook.serviceMaterial.listForService({
      serviceId: orgBService.id,
    });
    expect(listed).toHaveLength(0);
  });

  it("org B cannot attach a material (even its own) to org A's service", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const orgAService = await callerA.v1.pricebook.service.create({
      name: "Org A Cross-Tenant Target Service",
      unitPriceCents: 100,
      costCents: 10,
    });

    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const orgBMaterial = await callerB.v1.pricebook.material.create({
      name: "Org B Own Material",
      unitCostCents: 100,
    });

    await expect(
      callerB.v1.pricebook.serviceMaterial.attach({
        serviceId: orgAService.id,
        materialId: orgBMaterial.id,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── RBAC ───────────────────────────────────────────────────────────────────

  it("a tech is forbidden from all material and serviceMaterial mutations", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));

    await expect(
      callerTech.v1.pricebook.material.create({ name: "Nope", unitCostCents: 0 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      callerTech.v1.pricebook.serviceMaterial.attach({
        serviceId: randomUUID(),
        materialId: randomUUID(),
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
