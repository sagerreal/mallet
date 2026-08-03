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

// Capstone: exercise the full settings stack via createCaller — auth gate, RBAC, org-scoped
// transaction, use-case, Drizzle repo, and live RLS — without spinning up HTTP.
// Proves an owner can get/update config and manage all four collections; cross-tenant RLS
// prevents org B from reading or mutating org A's settings; a tech is forbidden entirely.
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

suite("settings tRPC router (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('SettingsApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('SettingsApi B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  // ── get (lazy defaults) ────────────────────────────────────────────────────

  it("get lazily creates a defaults row for a fresh org", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const snap = await caller.v1.settings.get();
    expect(snap.config.trade).toBe("plumbing");
    expect(snap.config.markupBps).toBe(3500);
    // NO services of our invention. This asserted the opposite until the plumbing blob was
    // deleted: nine hard-coded residential plumbing services with prices we made up
    // ("Drain cleaning $99"), handed to every org whatever its trade. Services now come from the
    // shop's own trade playbook at signup, and those carry no prices at all.
    expect(snap.config.booking.services).toEqual([]);
    expect(snap.pricebook).toEqual([]);
    expect(snap.laborRates).toEqual([]);
    expect(snap.terms).toEqual([]);
    expect(snap.sources).toEqual([]);
  });

  // ── updateConfig ───────────────────────────────────────────────────────────

  it("updateConfig persists scalars and the booking blob", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const cfg = await caller.v1.settings.updateConfig({
      markupBps: 4200,
      booking: { services: [], notServices: "septic", serviceFee: 120, feeCredited: false },
    });
    expect(cfg.markupBps).toBe(4200);
    expect(cfg.booking.serviceFee).toBe(120);
    expect(cfg.booking.feeCredited).toBe(false);

    // Verify the change is durable.
    const snap = await caller.v1.settings.get();
    expect(snap.config.markupBps).toBe(4200);
    expect(snap.config.booking.notServices).toBe("septic");
  });

  // ── measurementEstimating gate ────────────────────────────────────────────
  // Column added via migration 0108 (org_settings.measurement_estimating,
  // NOT NULL DEFAULT false) after PR #263/#264 cleared migration slot 0107.
  it("updateConfig persists measurementEstimating; defaults off on a fresh org", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const fresh = await caller.v1.settings.get();
    expect(fresh.config.measurementEstimating).toBe(false);

    const cfg = await caller.v1.settings.updateConfig({ measurementEstimating: true });
    expect(cfg.measurementEstimating).toBe(true);

    const snap = await caller.v1.settings.get();
    expect(snap.config.measurementEstimating).toBe(true);
  });

  // ── T3: requiredCerts round-trip ──────────────────────────────────────────
  // This test MUST FAIL before bookingServiceDTO gains the requiredCerts field
  // (zod silently strips unknown keys), and PASS after the DTO edit.

  it("requiredCerts survives the updateConfig → get round-trip (T3 strip-trap)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const cfg = await caller.v1.settings.updateConfig({
      booking: {
        services: [
          {
            name: "Water heater",
            lane: "repair",
            triggers: "no hot water",
            requiredCerts: ["Gas"],
          },
        ],
        notServices: "",
        serviceFee: 89,
        feeCredited: true,
      },
    });
    // Field must survive through the DTO parse + persist + response path.
    expect(cfg.booking.services[0]?.requiredCerts).toEqual(["Gas"]);

    // Durability: must survive a subsequent get.
    const snap = await caller.v1.settings.get();
    expect(snap.config.booking.services[0]?.requiredCerts).toEqual(["Gas"]);
  });

  it("updateConfig persists the service-origin address; get returns it", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const address = "1600 Pennsylvania Ave NW, Washington, DC 20500";
    const cfg = await caller.v1.settings.updateConfig({ serviceOriginAddress: address });

    // The address round-trips through the new columns. lat/lng are geocoded best-effort by the
    // real CensusGeocoder — assert only the SHAPE (number|null), never fail on a network miss.
    expect(cfg.serviceOriginAddress).toBe(address);
    expect(cfg.originLat === null || typeof cfg.originLat === "number").toBe(true);
    expect(cfg.originLng === null || typeof cfg.originLng === "number").toBe(true);

    const snap = await caller.v1.settings.get();
    expect(snap.config.serviceOriginAddress).toBe(address);

    // Clearing the address (null) drops the point too.
    const cleared = await caller.v1.settings.updateConfig({ serviceOriginAddress: null });
    expect(cleared.serviceOriginAddress).toBeNull();
    expect(cleared.originLat).toBeNull();
    expect(cleared.originLng).toBeNull();
  });

  // ── pricebook ──────────────────────────────────────────────────────────────

  it("pricebook create/update/remove round-trips", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));

    const created = await caller.v1.settings.pricebook.create({
      label: "Sewer camera",
      unitPriceCents: 28500,
      costCents: 0,
    });
    expect(created.label).toBe("Sewer camera");
    expect(created.unitPriceCents).toBe(28500);
    expect(created.costCents).toBe(0);

    const updated = await caller.v1.settings.pricebook.update({
      id: created.id,
      unitPriceCents: 30000,
    });
    expect(updated.id).toBe(created.id);
    expect(updated.unitPriceCents).toBe(30000);

    const removed = await caller.v1.settings.pricebook.remove({ id: created.id });
    expect(removed.ok).toBe(true);

    // Confirm the item is gone from the snapshot.
    const snap = await caller.v1.settings.get();
    expect(snap.pricebook.some((p) => p.id === created.id)).toBe(false);
  });

  // ── labor rates ───────────────────────────────────────────────────────────

  it("labor rate cannot delete the last active rate (CONFLICT)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const only = await caller.v1.settings.laborRates.create({
      label: "Standard",
      rateCentsPerHour: 17000,
    });
    // Org B has exactly one active rate; removing it must be rejected.
    await expect(
      caller.v1.settings.laborRates.remove({ id: only.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // ── lead sources ──────────────────────────────────────────────────────────

  it("duplicate source label is rejected with CONFLICT", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await caller.v1.settings.sources.create({ label: "Google" });
    // Case-insensitive duplicate must also be rejected.
    await expect(
      caller.v1.settings.sources.create({ label: "google" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // ── terms ─────────────────────────────────────────────────────────────────

  it("terms create/update/remove round-trips", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));

    const created = await caller.v1.settings.terms.create({
      title: "Payment policy",
      body: "Payment is due upon completion of work.",
    });
    expect(created.title).toBe("Payment policy");

    const updated = await caller.v1.settings.terms.update({
      id: created.id,
      title: "Updated payment policy",
    });
    expect(updated.title).toBe("Updated payment policy");

    const removed = await caller.v1.settings.terms.remove({ id: created.id });
    expect(removed.ok).toBe(true);
  });

  // ── cross-tenant RLS ──────────────────────────────────────────────────────

  it("org B sees none of org A's collections (RLS)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await callerA.v1.settings.pricebook.create({
      label: "A-only item",
      unitPriceCents: 100,
      costCents: 0,
    });

    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const snapB = await callerB.v1.settings.get();
    expect(snapB.pricebook.some((p) => p.id === created.id)).toBe(false);

    // Attempting to remove org A's item from org B's context must return NOT_FOUND.
    await expect(
      callerB.v1.settings.pricebook.remove({ id: created.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── RBAC ──────────────────────────────────────────────────────────────────

  it("a tech is forbidden from all settings procedures", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(callerTech.v1.settings.get()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      callerTech.v1.settings.updateConfig({ markupBps: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      callerTech.v1.settings.pricebook.create({ label: "Nope", unitPriceCents: 0, costCents: 0 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── updateBrand ──────────────────────────────────────────────────────────
  // NOTE: These tests are WRITTEN but UNRUN — migration 0046 (brand_* columns on
  // org_settings + orgs.name write) is not yet applied in this environment. They
  // will pass once `npm run db:migrate` has run the pending brand migration in CI.

  describe("v1.settings.updateBrand", () => {
    it("owner updates brand; get returns it and orgs.name reflects the name", async () => {
      const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
      const updated = await caller.v1.settings.updateBrand({
        name: "Rivera Plumbing",
        tagline: "Licensed & insured",
        site: "riveraplumbing.com",
        color: "#9C5B34",
        initials: "RP",
      });
      expect(updated.brand.name).toBe("Rivera Plumbing");
      expect(updated.brand.color).toBe("#9C5B34");

      const fetched = await caller.v1.settings.get();
      expect(fetched.brand.name).toBe("Rivera Plumbing");
      expect(fetched.brand.tagline).toBe("Licensed & insured");

      const me = await caller.v1.identity.me();
      expect(me.orgName).toBe("Rivera Plumbing");
    });

    it("rejects a blank brand name with BAD_REQUEST", async () => {
      const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
      await expect(
        caller.v1.settings.updateBrand({ name: "   " }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("a tech is forbidden from updateBrand", async () => {
      const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));
      await expect(
        callerTech.v1.settings.updateBrand({ name: "Nope" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("org B cannot read org A's brand (RLS isolation)", async () => {
      const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
      await callerA.v1.settings.updateBrand({ name: "Org A Plumbing", color: "#123456" });
      const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
      const bSettings = await callerB.v1.settings.get(); // lazily creates B's own row
      expect(bSettings.brand.color).not.toBe("#123456");
    });
  });

  // Stripe Connect payments (PR1). Requires migration 0083 applied to the live DB.
  describe("payments (stripe connect)", () => {
    it("status returns not-connected defaults for a fresh org", async () => {
      const caller = appRouter.createCaller(ctxFor(orgBId, "owner"));
      const s = await caller.v1.settings.payments.status();
      expect(s).toEqual({
        hasAccount: false,
        detailsSubmitted: false,
        chargesEnabled: false,
        payoutsEnabled: false,
      });
    });

    it("beginOnboarding is PRECONDITION_FAILED when Stripe is unconfigured (null gateway)", async () => {
      const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
      await expect(caller.v1.settings.payments.beginOnboarding()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    });

    it("a tech is forbidden from reading payments status", async () => {
      const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));
      await expect(callerTech.v1.settings.payments.status()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });
});
