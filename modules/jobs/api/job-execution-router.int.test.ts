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

const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

const ctxFor = (orgId: string, userId: string, role: Role): Context => ({
  principal: { userId: asUserId(userId), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: {
    authProvider: stubAuth,
    bus: new InMemoryEventBus(),
    clock: systemClock,
    ids: uuidGenerator,
    paymentLinkGateway: null,
    photoStorageGateway: null,
    llmClient: null,
    apiKeyAuthenticator: { authenticate: async () => null },
    tokenVerifier: { verify: async () => null },
    signupStore: { createOrgForUser: async () => { throw new Error("unused"); } },
  },
});

suite("v1.jobs execution data (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";
  let jobId = "";
  const ownerA = randomUUID();

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('ExecApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('ExecApi B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    const [la] = await admin<{ id: string }[]>`insert into leads (org_id, name) values (${orgAId}, 'Cust A') returning id`;
    leadAId = la!.id;
    // Create a job to attach execution data to (scheduleDirect exists pre-Phase-5).
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerA, "owner"));
    const job = await caller.v1.jobs.scheduleDirect({ leadId: leadAId, title: "Exec Test Job" });
    jobId = job.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("adds a line and it comes back on the job DTO", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerA, "owner"));
    const dto = await caller.v1.jobs.addLine({ jobId, description: "Panel swap", quantity: 2, rateCents: 5000, costCents: 1000 });
    expect(dto.lines).toHaveLength(1);
    expect(dto.lines[0]?.description).toBe("Panel swap");
    expect(dto.lines[0]?.rate?.cents).toBe(5000);
  });

  it("updates then removes a line", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerA, "owner"));
    const added = await caller.v1.jobs.addLine({ jobId, description: "Temp", quantity: 1, rateCents: 100, costCents: 0 });
    const lineId = added.lines.find((l) => l.description === "Temp")!.id;
    const updated = await caller.v1.jobs.updateLine({ jobId, lineId, description: "Renamed", quantity: 3, rateCents: 200, costCents: 0, position: 1 });
    expect(updated.lines.find((l) => l.id === lineId)?.description).toBe("Renamed");
    const removed = await caller.v1.jobs.removeLine({ jobId, lineId });
    expect(removed.lines.some((l) => l.id === lineId)).toBe(false);
  });

  it("adds an addon, approves it, and toggles invoice skip", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerA, "owner"));
    const added = await caller.v1.jobs.addAddon({ jobId, description: "Extra outlet", rateCents: 9000, costCents: 0 });
    const addonId = added.addons.find((a) => a.description === "Extra outlet")!.id;
    expect(added.addons.find((a) => a.id === addonId)?.status).toBe("proposed");
    const approved = await caller.v1.jobs.setAddonStatus({ jobId, addonId, status: "approved" });
    expect(approved.addons.find((a) => a.id === addonId)?.status).toBe("approved");
    const skipped = await caller.v1.jobs.setAddonInvSkip({ jobId, addonId, invoiceSkip: true });
    expect(skipped.addons.find((a) => a.id === addonId)?.invoiceSkip).toBe(true);
  });

  it("sets a verify answer, overrides it, then clears it", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerA, "owner"));
    // Answers are validated against the job's ATTACHED checklist — attach one first.
    await caller.v1.jobs.update({
      jobId,
      checklist: {
        name: "Before you leave",
        items: [
          { id: "5", text: "Water back on", type: "check", required: true },
          { id: "9", text: "Site photo", type: "photo", required: false },
        ],
      },
    });
    const passed = await caller.v1.jobs.setVerifyAnswer({ jobId, itemId: "5", state: "pass", via: "manual" });
    expect(passed.verifyAnswers.find((v) => v.itemId === "5")?.state).toBe("pass");
    const overridden = await caller.v1.jobs.setVerifyAnswer({ jobId, itemId: "5", state: "override", reason: "N/A on this unit" });
    expect(overridden.verifyAnswers.find((v) => v.itemId === "5")?.state).toBe("override");
    expect(overridden.verifyAnswers).toHaveLength(1); // upsert, not a second row
    const cleared = await caller.v1.jobs.setVerifyAnswer({ jobId, itemId: "5", state: "clear" });
    expect(cleared.verifyAnswers.some((v) => v.itemId === "5")).toBe(false);
  });

  it("override without a reason is BAD_REQUEST", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerA, "owner"));
    await expect(
      caller.v1.jobs.setVerifyAnswer({ jobId, itemId: "9", state: "override" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a verify answer for an itemId that is not on the attached checklist", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerA, "owner"));
    await expect(
      caller.v1.jobs.setVerifyAnswer({ jobId, itemId: "not-a-real-item", state: "pass", via: "manual" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const rows = await admin`select item_id from job_verify_answers where job_id = ${jobId}`;
    expect(rows.every((r) => r.item_id !== "not-a-real-item")).toBe(true);
  });

  it("records a photo metadata row and removes it", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerA, "owner"));
    const path = `${orgAId}/${jobId}/${randomUUID()}.jpg`;
    const added = await caller.v1.jobs.addPhoto({ jobId, storagePath: path, verifyPass: true });
    const photoId = added.photos.find((p) => p.storagePath === path)!.id;
    expect(added.photos.find((p) => p.id === photoId)?.verifyPass).toBe(true);
    const removed = await caller.v1.jobs.removePhoto({ jobId, photoId });
    expect(removed.photos.some((p) => p.id === photoId)).toBe(false);
  });

  it("photoUploadUrl returns PRECONDITION_FAILED when storage is unconfigured", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerA, "owner"));
    await expect(
      caller.v1.jobs.photoUploadUrl({ jobId, objectId: randomUUID(), ext: "jpg" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("org B cannot add a line to org A's job (NOT_FOUND via RLS)", async () => {
    const callerB = appRouter.createCaller(ctxFor(orgBId, randomUUID(), "owner"));
    await expect(
      callerB.v1.jobs.addLine({ jobId, description: "sneaky", quantity: 1, rateCents: 1, costCents: 0 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a tech is forbidden from office execution mutations", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, randomUUID(), "tech"));
    await expect(
      callerTech.v1.jobs.addLine({ jobId, description: "nope", quantity: 1, rateCents: 1, costCents: 0 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
