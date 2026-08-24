import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import { withTenant } from "@mallet/shared/db/tx";
import type { AuthProvider, Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import { TRADE_KEYS } from "@/app/(office)/settings/trade-playbooks";
import type { Context } from "@/trpc/init";
import { DrizzleSettingsRepository } from "../infra/drizzle-settings-repository";

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

/** Numbers the front desk asked to have wired, per test. Reset in each case that reads it. */
const registered: string[] = [];
const spyRegistrar = {
  register: async ({ phoneNumber }: { phoneNumber: string }) => {
    registered.push(phoneNumber);
    return { ok: true as const, value: undefined };
  },
};

const ctxFor = (orgId: string, role: Role, withRegistrar = false): Context => ({
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
    ...(withRegistrar ? { voiceRegistrar: spyRegistrar } : {}),
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

  // ── agentAutonomy: fail-closed default + owner-only write ────────────────
  //
  // Task 16's own hazard, proved directly rather than assumed: getAgentAutonomy skips getConfig's
  // lazy insert on purpose (Task 17's runner calls it inside the tenant tx on the approval path,
  // where writing a row is not this read's job), so a brand-new org has no row to fall back to.
  // It must resolve to the SAME value the schema itself defaults to — "supervised" — never
  // anything more permissive, or a shop that never opened Settings would silently be granted more
  // autonomy than it ever chose.
  //
  // Uses its OWN throwaway org (never orgAId/orgBId, both of which already have a row from the
  // tests above) and deletes it in afterAll, per this suite's live-DB rule.
  describe("agentAutonomy", () => {
    let freshOrgId = "";

    beforeAll(async () => {
      const [o] = await admin<{ id: string }[]>`
        insert into orgs (name) values ('AgentAutonomy ' || gen_random_uuid()) returning id`;
      freshOrgId = o!.id;
    });

    afterAll(async () => {
      if (freshOrgId) await admin`delete from orgs where id = ${freshOrgId}`;
    });

    it("reads supervised on a brand-new org with no org_settings row, and creates no row doing it", async () => {
      const orgId = asOrgId(freshOrgId);
      const level = await withTenant(orgId, (tx) =>
        new DrizzleSettingsRepository(tx, orgId).getAgentAutonomy(),
      );
      expect(level).toBe("supervised");

      // The read is side-effect-free — proves this wasn't secretly a lazy getConfig call.
      const hasRow = await withTenant(orgId, (tx) =>
        new DrizzleSettingsRepository(tx, orgId).hasConfig(),
      );
      expect(hasRow).toBe(false);
    });

    it("updateConfig refuses agentAutonomy from an office caller, but still saves their other edits", async () => {
      const office = appRouter.createCaller(ctxFor(freshOrgId, "office"));
      const owner = appRouter.createCaller(ctxFor(freshOrgId, "owner"));

      await expect(
        office.v1.settings.updateConfig({ agentAutonomy: "autonomous", markupBps: 4500 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      // The refused mutation applied NONE of its fields — the office-only field cannot sneak a
      // partial write through, now or after a future refactor.
      const afterReject = await owner.v1.settings.get();
      expect(afterReject.config.markupBps).not.toBe(4500);
      expect(afterReject.config.agentAutonomy).toBe("supervised");

      // Office can still change everything else in the very next call, as long as
      // agentAutonomy is left out of it.
      const cfg = await office.v1.settings.updateConfig({ markupBps: 4600 });
      expect(cfg.markupBps).toBe(4600);
      expect(cfg.agentAutonomy).toBe("supervised");

      // Only the owner may raise the level.
      const raised = await owner.v1.settings.updateConfig({ agentAutonomy: "assisted" });
      expect(raised.agentAutonomy).toBe("assisted");
    });
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

  it("presentation templates create/update/remove round-trip, with default pages", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));

    const created = await caller.v1.settings.presentationTemplates.create({ name: "Interior" });
    expect(created.name).toBe("Interior");
    // A new template ships the full page set, all on, bodies empty — no demo copy.
    expect(created.pages.map((p) => p.key)).toEqual(["cover", "about", "reviews", "thanks"]);
    expect(created.pages.every((p) => p.on)).toBe(true);
    expect(created.pages.every((p) => p.body === "")).toBe(true);

    const updated = await caller.v1.settings.presentationTemplates.update({
      id: created.id,
      name: "Interior repaint",
      pages: created.pages.map((p) =>
        p.key === "about" ? { ...p, title: "About us", body: "Family-run since 2011." } : p,
      ),
    });
    expect(updated.name).toBe("Interior repaint");
    expect(updated.pages.find((p) => p.key === "about")?.body).toBe("Family-run since 2011.");

    const listed = await caller.v1.settings.presentationTemplates.list();
    expect(listed.find((t) => t.id === created.id)?.pages.find((p) => p.key === "about")?.body).toBe(
      "Family-run since 2011.",
    );

    const removed = await caller.v1.settings.presentationTemplates.remove({ id: created.id });
    expect(removed.ok).toBe(true);
    expect((await caller.v1.settings.presentationTemplates.list()).some((t) => t.id === created.id)).toBe(false);
  });

  // ── cross-tenant RLS ──────────────────────────────────────────────────────

  it("org B cannot see or mutate org A's presentation templates (RLS on the new table)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await callerA.v1.settings.presentationTemplates.create({ name: "A-only deck" });

    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    expect((await callerB.v1.settings.presentationTemplates.list()).some((t) => t.id === created.id)).toBe(false);

    await expect(
      callerB.v1.settings.presentationTemplates.update({ id: created.id, name: "stolen" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      callerB.v1.settings.presentationTemplates.remove({ id: created.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Org A still owns it, unchanged.
    expect((await callerA.v1.settings.presentationTemplates.list()).find((t) => t.id === created.id)?.name).toBe(
      "A-only deck",
    );
  });

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

  it("a tech is forbidden from all settings procedures EXCEPT the field toggles read", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(callerTech.v1.settings.get()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      callerTech.v1.settings.updateConfig({ markupBps: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      callerTech.v1.settings.pricebook.create({ label: "Nope", unitPriceCents: 0, costCents: 0 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── v1.settings.fieldToggles ──────────────────────────────────────────────

  /**
   * The tech-readable capability flag. It exists because SettingsHydrator writes store.toggles and
   * is ownerOrOffice, so a technician's measurementEstimating stayed unhydrated forever and the
   * field Quote tab's "Scan a room" row — the field scanner's own surface — never rendered for the
   * role it was built for. The office payload was NOT widened; this is one boolean.
   */
  it("a TECH can read fieldToggles, and it tracks the org's real setting", async () => {
    const owner = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const tech = appRouter.createCaller(ctxFor(orgAId, "tech"));

    await owner.v1.settings.updateConfig({ measurementEstimating: true });
    await expect(tech.v1.settings.fieldToggles()).resolves.toMatchObject({
      measurementEstimating: true,
    });

    await owner.v1.settings.updateConfig({ measurementEstimating: false });
    await expect(tech.v1.settings.fieldToggles()).resolves.toMatchObject({
      measurementEstimating: false,
    });
  });

  it("fieldToggles leaks NOTHING else — the payload is exactly the allow-list", async () => {
    const tech = appRouter.createCaller(ctxFor(orgAId, "tech"));
    const toggles = await tech.v1.settings.fieldToggles();
    // The output zod schema strips unknown keys, so this asserts the schema, not the mapper.
    // Anything added to it becomes readable by every technician in the org.
    //
    // `timesheetClock` was added deliberately: whether the shop punches a clock is a working
    // practice every technician learns on their first morning, and the field surface cannot render
    // correctly without it (`settings.get` is ownerOrOffice and always will be). Not money, not a
    // credential, not a permission. The bar for the next one is the same question — would a
    // technician learn something here they could not learn by doing their job?
    //
    // `techEditsTimes` clears the same bar, and answering NO to it would be worse than answering
    // yes: without it the My hours page cannot know whether to render its editing controls, so a
    // technician would be shown pencils and Add buttons that the server refuses — a screen that
    // lies about what it can do. It is a capability, not a secret: the man finds out the first
    // time he tries to fix a punch.
    //
    // `overtime` clears it for a blunter reason: MY HOURS COMPUTES MY OVERTIME. Without the rule
    // the page can only assume federal weekly-40, which understates what a technician in a
    // daily-overtime state is owed — and a man learns his own overtime rule from his first
    // paycheck, so there is nothing here to keep from him.
    expect(Object.keys(toggles).sort()).toEqual(["canText", "measurementEstimating", "overtime", "techEditsTimes", "timesheetClock"]);
  });

  it("fieldToggles is org-scoped — org B never sees org A's flag", async () => {
    await appRouter.createCaller(ctxFor(orgAId, "owner")).v1.settings.updateConfig({
      measurementEstimating: true,
    });
    const techB = appRouter.createCaller(ctxFor(orgBId, "tech"));
    await expect(techB.v1.settings.fieldToggles()).resolves.toMatchObject({
      measurementEstimating: false,
    });
  });

  // ── v1.settings.businessIdentity ──────────────────────────────────────────

  /**
   * WHO billed the customer, readable by a TECH. It exists for the same structural reason
   * fieldToggles does — `get` is ownerOrOffice and the field layout cannot mount its hydrator for
   * a technician — but the consequence was on a CUSTOMER's document: the close-out sheet a
   * technician turns around at the door renders the same <InvoiceDocument> as `/i/<token>`, and
   * without this it had no address, no phone and no licence on it.
   */
  it("a TECH can read businessIdentity, and it tracks what the office typed in Settings", async () => {
    const owner = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const tech = appRouter.createCaller(ctxFor(orgAId, "tech"));

    await owner.v1.settings.updateBusiness({
      address: "200 Ray St, Pleasanton, CA 94566",
      phone: "(925) 555-0100",
      email: "billing@ridgeline.test",
      license: "C36-1029384",
    });

    const identity = await tech.v1.settings.businessIdentity();
    expect(identity.address).toBe("200 Ray St, Pleasanton, CA 94566");
    expect(identity.phone).toBe("(925) 555-0100");
    expect(identity.email).toBe("billing@ridgeline.test");
    expect(identity.license).toBe("C36-1029384");
    // orgs.name — the value a technician's store cannot get any other way (BrandHydrator is
    // office-only), and the placeholder it would otherwise print to a customer is "My Business".
    expect(identity.name).toMatch(/^SettingsApi A /);
  });

  it("businessIdentity leaks NOTHING else — the payload is exactly six keys", async () => {
    const tech = appRouter.createCaller(ctxFor(orgAId, "tech"));
    const identity = await tech.v1.settings.businessIdentity();
    // The output zod schema strips unknown keys, so this asserts the schema, not the mapper.
    // Anything added to it becomes readable by every technician in the org.
    expect(Object.keys(identity).sort()).toEqual([
      "address",
      "email",
      "license",
      "name",
      "phone",
      "site",
    ]);
  });

  it("businessIdentity is org-scoped — org B never sees org A's address", async () => {
    await appRouter.createCaller(ctxFor(orgAId, "owner")).v1.settings.updateBusiness({
      address: "200 Ray St, Pleasanton, CA 94566",
    });
    const techB = appRouter.createCaller(ctxFor(orgBId, "tech"));
    const identity = await techB.v1.settings.businessIdentity();
    expect(identity.address).toBeNull();
    expect(identity.name).toMatch(/^SettingsApi B /);
  });

  // ── the trade boundary ────────────────────────────────────────────────────

  /**
   * The write that broke a real shop. `trade` was `z.string().min(1).max(50)`, so a display LABEL
   * was accepted and stored — after which playbookFor / pricebookFor / tradeMeasures all matched
   * nothing, and the client, deriving from that miss, sent measurementEstimating:false alongside
   * it. The boundary now refuses anything that is not a known key.
   */
  it("updateConfig REJECTS a trade label or any unknown trade, and stores neither", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const before = await caller.v1.settings.get();

    for (const bad of ["Plumbing", "Concrete & flatwork", "nonesuch", ""]) {
      await expect(
        caller.v1.settings.updateConfig({ trade: bad as "plumbing" }),
        bad,
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }

    const after = await caller.v1.settings.get();
    expect(after.config.trade).toBe(before.config.trade);
  });

  it("updateConfig accepts every real trade KEY", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    for (const key of TRADE_KEYS) {
      const cfg = await caller.v1.settings.updateConfig({ trade: key });
      expect(cfg.trade, key).toBe(key);
    }
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

  // ── documents (wording slots) ─────────────────────────────────────────────
  // Requires migration 0148 (org_settings.doc_* columns) applied to the live DB.

  describe("v1.settings.updateDocuments + documentWording", () => {
    it("owner updates the slots; get returns them raw on `documents`", async () => {
      const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
      const updated = await caller.v1.settings.updateDocuments({
        invoiceFooter: "Thanks for your business — 1-year warranty on labor.",
        payInstructions: "Zelle to (925) 555-0100 or mail a check to 200 Ray St.",
        receiptNote: "Paid in full — thank you!",
        changeOrderAgreement: "Approved as extra work on this job, billed with the final invoice.",
      });
      expect(updated.documents.invoiceFooter).toBe(
        "Thanks for your business — 1-year warranty on labor.",
      );

      const fetched = await caller.v1.settings.get();
      expect(fetched.documents).toEqual({
        invoiceFooter: "Thanks for your business — 1-year warranty on labor.",
        payInstructions: "Zelle to (925) 555-0100 or mail a check to 200 Ray St.",
        receiptNote: "Paid in full — thank you!",
        changeOrderAgreement:
          "Approved as extra work on this job, billed with the final invoice.",
      });
    });

    it("a blank override stores null through the whole stack — never a stored space", async () => {
      const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
      await caller.v1.settings.updateDocuments({ receiptNote: "   " });
      const fetched = await caller.v1.settings.get();
      expect(fetched.documents.receiptNote).toBeNull();
    });

    it("explicit null clears one slot and leaves the others standing", async () => {
      const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
      await caller.v1.settings.updateDocuments({
        invoiceFooter: "Keep me.",
        payInstructions: "Clear me later.",
      });
      await caller.v1.settings.updateDocuments({ payInstructions: null });
      const fetched = await caller.v1.settings.get();
      expect(fetched.documents.invoiceFooter).toBe("Keep me.");
      expect(fetched.documents.payInstructions).toBeNull();
    });

    it("rejects an over-length agreement line with BAD_REQUEST and stores nothing", async () => {
      const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
      const before = await caller.v1.settings.get();
      await expect(
        caller.v1.settings.updateDocuments({ changeOrderAgreement: "x".repeat(301) }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const after = await caller.v1.settings.get();
      expect(after.documents.changeOrderAgreement).toBe(before.documents.changeOrderAgreement);
    });

    it("a tech is forbidden from updateDocuments", async () => {
      const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));
      await expect(
        callerTech.v1.settings.updateDocuments({ invoiceFooter: "Nope" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    /**
     * The tech-readable wording slice. It exists for the same structural reason
     * businessIdentity does: the close-out document a technician turns around at the door
     * renders the invoice footer, and the change-order sign screen renders the agreement
     * line — both from the FIELD layout, which cannot mount the ownerOrOffice hydrator.
     */
    it("a TECH can read documentWording, and it tracks what the office typed", async () => {
      const owner = appRouter.createCaller(ctxFor(orgAId, "owner"));
      const tech = appRouter.createCaller(ctxFor(orgAId, "tech"));

      await owner.v1.settings.updateDocuments({
        invoiceFooter: "1-year warranty on labor.",
        changeOrderAgreement: "Extra work approved at the door.",
      });
      await expect(tech.v1.settings.documentWording()).resolves.toEqual({
        invoiceFooter: "1-year warranty on labor.",
        changeOrderAgreement: "Extra work approved at the door.",
      });
    });

    it("documentWording leaks NOTHING else — the payload is exactly two keys", async () => {
      const tech = appRouter.createCaller(ctxFor(orgAId, "tech"));
      const wording = await tech.v1.settings.documentWording();
      // The output zod schema strips unknown keys, so this asserts the schema, not the mapper.
      // Anything added to it becomes readable by every technician in the org. The public-page
      // slots (payInstructions, receiptNote) are deliberately NOT on this wire.
      expect(Object.keys(wording).sort()).toEqual(["changeOrderAgreement", "invoiceFooter"]);
    });

    it("documentWording is org-scoped — org B never sees org A's sentences", async () => {
      await appRouter.createCaller(ctxFor(orgAId, "owner")).v1.settings.updateDocuments({
        invoiceFooter: "A-only footer.",
      });
      const techB = appRouter.createCaller(ctxFor(orgBId, "tech"));
      const wording = await techB.v1.settings.documentWording();
      expect(wording.invoiceFooter).toBeNull();
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

  /**
   * A LINE THAT WAS NEVER WIRED REPAIRS ITSELF when the shop switches the desk on.
   *
   * Registration runs once, at provisioning. While VAPI_API_KEY was unset in production that step
   * silently self-disabled, so numbers were bought and left on Twilio's "not configured" recording.
   * Setting the key fixes future signups and nothing already sold — a one-off back-fill would clear
   * today's three and leave the same hole after any future outage, so the repair lives here.
   */
  describe("switching the front desk on wires the number", () => {
    it("asks the registrar for the org's own line", async () => {
      registered.length = 0;
      await admin`update orgs set twilio_number = '+15550001111' where id = ${orgAId}`;
      const caller = appRouter.createCaller(ctxFor(orgAId, "owner", true));

      // A row that passes frontDeskReadiness, then the switch.
      await caller.v1.settings.updateConfig({
        serviceOriginAddress: "02189",
        booking: {
          services: [{ name: "Drain cleaning", lane: "flat", price: 189, triggers: "" }],
          notServices: "",
          serviceFee: 0,
          feeCredited: false,
        },
      });
      await caller.v1.settings.updateConfig({ frontDesk: true });

      expect(registered).toEqual(["+15550001111"]);
      await admin`update orgs set twilio_number = null where id = ${orgAId}`;
    });

    it("does not call the registrar on an unrelated save", async () => {
      // Every settings write would otherwise hit Vapi — a cost and a dependency for editing a tax rate.
      registered.length = 0;
      const caller = appRouter.createCaller(ctxFor(orgAId, "owner", true));
      await caller.v1.settings.updateConfig({ taxBps: 625 });
      expect(registered).toEqual([]);
    });

    it("saves the settings even when the org owns no number yet", async () => {
      // Provisioning can lag signup; the switch must not fail because the line has not landed.
      registered.length = 0;
      await admin`update orgs set twilio_number = null where id = ${orgAId}`;
      const caller = appRouter.createCaller(ctxFor(orgAId, "owner", true));
      const cfg = await caller.v1.settings.updateConfig({ frontDesk: true });
      expect(cfg.frontDesk).toBe(true);
      expect(registered).toEqual([]);
    });
  });
});
