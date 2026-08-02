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
import { DEFAULT_ASSEMBLIES } from "../domain/assembly-defaults";

// Capstone: the full assemblies stack via createCaller — auth gate, RBAC,
// org-scoped tx, use-cases, Drizzle repo, live RLS. Proves the read-time
// catalog merge (zero rows → full default book), copy-on-write dial overrides,
// per-field reset, catalog tombstones, custom CRUD, seed-through-endpoint, and
// that none of it leaks across tenants.
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

suite("assemblies tRPC router (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('AssembliesApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('AssembliesApi B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    const [la] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgAId}, 'Cust A') returning id`;
    leadAId = la!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  // ── read-time catalog merge ────────────────────────────────────────────────

  it("an untouched org lists the full shipped catalog from ZERO rows", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const items = await caller.v1.assemblies.list();
    expect(items.map((i) => i.catalogKey)).toEqual(
      DEFAULT_ASSEMBLIES.map((d) => d.catalogKey),
    );
    expect(items.every((i) => i.id.startsWith("catalog:") && !i.isOverride)).toBe(true);
    const [rowCount] = await admin<{ count: string }[]>`
      select count(*)::text as count from assemblies where org_id = ${orgAId}`;
    expect(rowCount?.count).toBe("0");
  });

  // ── copy-on-write override + reset ─────────────────────────────────────────

  it("a dial edit materializes ONE override row; a second edit patches it; reset restores the default", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));

    const saved = await caller.v1.assemblies.saveDial({
      assemblyId: "catalog:driveway_replacement_3in",
      dialKey: "hma_price",
      rawValue: 13_500,
    });
    expect(saved.isOverride).toBe(true);
    expect(saved.id).not.toContain("catalog:");
    expect(saved.dials.find((d) => d.key === "hma_price")).toMatchObject({
      currentRaw: 13_500,
      defaultRaw: 12_000,
    });

    // Second edit addresses the row id — still exactly one row.
    const again = await caller.v1.assemblies.saveDial({
      assemblyId: saved.id,
      dialKey: "margin",
      rawValue: 3_000,
    });
    expect(again.marginBps).toBe(3_000);
    const [rowCount] = await admin<{ count: string }[]>`
      select count(*)::text as count from assemblies where org_id = ${orgAId}`;
    expect(rowCount?.count).toBe("1");

    // The list swaps the catalog item for the override.
    const items = await caller.v1.assemblies.list();
    const driveway = items.find((i) => i.catalogKey === "driveway_replacement_3in")!;
    expect(driveway.id).toBe(saved.id);
    expect(driveway.marginBps).toBe(3_000);

    // Per-field reset = writing the shipped value back through the same dial.
    const reset = await caller.v1.assemblies.saveDial({
      assemblyId: saved.id,
      dialKey: "hma_price",
      rawValue: 12_000,
    });
    expect(reset.dials.find((d) => d.key === "hma_price")).toMatchObject({
      currentRaw: 12_000,
      defaultRaw: 12_000,
    });
  });

  // ── tenant isolation ───────────────────────────────────────────────────────

  it("org B sees pure catalog (no A overrides) and cannot address A's row", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));

    const itemsB = await callerB.v1.assemblies.list();
    const drivewayB = itemsB.find((i) => i.catalogKey === "driveway_replacement_3in")!;
    expect(drivewayB.isOverride).toBe(false);
    expect(drivewayB.marginBps).toBe(2_500); // A's 30% never leaks

    const itemsA = await callerA.v1.assemblies.list();
    const rowIdA = itemsA.find((i) => i.catalogKey === "driveway_replacement_3in")!.id;
    await expect(
      callerB.v1.assemblies.saveDial({ assemblyId: rowIdA, dialKey: "margin", rawValue: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      callerB.v1.assemblies.archive({ assemblyId: rowIdA }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a tech is forbidden from the whole surface (RBAC)", async () => {
    const tech = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(tech.v1.assemblies.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      tech.v1.assemblies.saveDial({
        assemblyId: "catalog:crack_filling",
        dialKey: "rate",
        rawValue: 100,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── custom CRUD + catalog tombstone ────────────────────────────────────────

  it("creates and archives a custom assembly; archiving a default tombstones it out of the list", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const crack = DEFAULT_ASSEMBLIES.find((d) => d.catalogKey === "crack_filling")!;

    const custom = await caller.v1.assemblies.create({
      name: "Trench patch",
      measurementBasis: "perimeter",
      pricingMode: "unit_rate",
      marginBps: 0,
      jobMinimumCents: 0,
      config: crack.config,
    });
    expect(custom.catalogKey).toBeNull();
    expect((await caller.v1.assemblies.list()).some((i) => i.name === "Trench patch")).toBe(true);

    await caller.v1.assemblies.archive({ assemblyId: custom.id });
    expect((await caller.v1.assemblies.list()).some((i) => i.name === "Trench patch")).toBe(false);

    // Soft delete, never a hard delete.
    const [row] = await admin<{ deleted_at: string | null }[]>`
      select deleted_at from assemblies where id = ${custom.id}`;
    expect(row?.deleted_at).not.toBeNull();

    // Remove a shipped default: a tombstone row hides it from the book.
    await caller.v1.assemblies.archive({ assemblyId: "catalog:paver_driveway" });
    const items = await caller.v1.assemblies.list();
    expect(items.some((i) => i.catalogKey === "paver_driveway")).toBe(false);
  });

  // ── seed through the endpoint ──────────────────────────────────────────────

  it("prices a persisted capture through an assembly — default constants, then the org override", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const job = await caller.v1.jobs.create({ leadId: leadAId, title: "Sealcoat the lot" });
    await caller.v1.measurements.siteCreate({
      jobId: job.id,
      name: "Back lot",
      source: "manual",
      surface: "flat",
      areaSqft: 3000,
    });

    const seeded = await caller.v1.assemblies.seedFromCapture({
      jobId: job.id,
      sourceName: "Back lot",
      assemblyId: "catalog:sealcoat_two_coats",
    });
    expect(seeded.lines[0]).toMatchObject({
      description: "Back lot — Sealcoat, two coats",
      quantity: 3000,
      rateCents: 22,
    });
    expect(seeded.totalCents).toBe(66_000);
    expect(seeded.minimum).toBeNull();

    // Override the mid bracket and the same endpoint prices with YOUR number.
    await caller.v1.assemblies.saveDial({
      assemblyId: "catalog:sealcoat_two_coats",
      dialKey: "rate_mid",
      rawValue: 30,
    });
    const reseeded = await caller.v1.assemblies.seedFromCapture({
      jobId: job.id,
      sourceName: "Back lot",
      assemblyId: "catalog:sealcoat_two_coats",
    });
    expect(reseeded.lines[0]!.rateCents).toBe(30);

    // Cross-tenant: org B cannot seed from org A's job.
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    await expect(
      callerB.v1.assemblies.seedFromCapture({
        jobId: job.id,
        sourceName: "Back lot",
        assemblyId: "catalog:sealcoat_two_coats",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // A removed default refuses to price.
    await expect(
      caller.v1.assemblies.seedFromCapture({
        jobId: job.id,
        sourceName: "Back lot",
        assemblyId: "catalog:paver_driveway", // tombstoned in the prior test
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
