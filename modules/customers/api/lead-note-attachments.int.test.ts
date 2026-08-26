import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { asOrgId, asUserId, systemClock, ok, err, externalService } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { PhotoStorageGateway } from "@mallet/jobs";
import type { AuthProvider, Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

/**
 * A customer note's ONE attachment, through the whole stack against live RLS.
 *
 * The thing worth testing here is not that a file uploads — it is that the link is minted from
 * the path the ROW holds, never from one a caller named. A note id is a uuid a client can type,
 * so `noteViewUrl` is the endpoint that would leak another shop's permit if the lookup were
 * loose. The foreign-org and wrong-customer cases below are the point of the file.
 */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

/**
 * A storage double that records every path it was asked to sign.
 *
 * Recording is the assertion: "the URL came from the stored path" is only checkable by looking
 * at what the gateway was handed, and "the foreign caller got nothing" is only fully checked by
 * confirming the gateway was never reached at all.
 */
const signedFor: string[] = [];
const fakeStorage: PhotoStorageGateway = {
  createUploadUrl: vi.fn(async (cmd) => {
    const storagePath = `${cmd.orgId}/${cmd.jobId}/${cmd.objectId}.${cmd.ext}`;
    return ok({ signedUrl: `https://storage.test/upload/${storagePath}`, token: "t", storagePath });
  }),
  download: vi.fn(async () => err(externalService("supabase-storage", "not used here", false))),
  createViewUrl: vi.fn(async (storagePath, ctx) => {
    // Mirror the real adapter's prefix rule so a path outside the customer's folder cannot pass
    // this double either — a fake that signs anything would hide the bug the check exists for.
    if (!storagePath.startsWith(`${ctx.orgId}/${ctx.jobId}/`)) {
      return err(externalService("supabase-storage", "storage path is outside the expected folder", false));
    }
    signedFor.push(storagePath);
    return ok({ url: `https://storage.test/view/${storagePath}`, expiresInSeconds: 300 });
  }),
};

const ctxFor = (orgId: string, role: Role, storage: PhotoStorageGateway | null = fakeStorage): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: {
    authProvider: stubAuth,
    bus: new InMemoryEventBus(),
    clock: systemClock,
    ids: uuidGenerator,
    paymentLinkGateway: null,
    connectGateway: null,
    photoStorageGateway: storage,
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

suite("customer note attachments (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";
  let otherLeadId = "";

  /** The key shape the app mints: <org>/leads/<lead>/<uuid>.<ext>. */
  const keyFor = (orgId: string, leadId: string, ext = "pdf") =>
    `${orgId}/leads/${leadId}/${randomUUID()}.${ext}`;

  const attach = (orgId: string, leadId: string, name = "permit.pdf") => ({
    path: keyFor(orgId, leadId),
    type: "application/pdf",
    name,
  });

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('NoteAttach A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('NoteAttach B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;

    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    leadAId = (await caller.v1.customers.create({ name: "Jill Vance", phone: "(555) 214-8801" })).id;
    otherLeadId = (await caller.v1.customers.create({ name: "Ray Okafor", phone: "(555) 214-8802" })).id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("an attachment survives the round-trip onto the trail", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const id = randomUUID();
    const a = attach(orgAId, leadAId);
    await caller.v1.customers.addNote({ id, leadId: leadAId, kind: "note", body: "Permit", attachment: a });

    const { items } = await caller.v1.customers.listNotes({ leadId: leadAId });
    expect(items.find((n) => n.id === id)).toMatchObject({
      attachmentPath: a.path,
      attachmentType: "application/pdf",
      attachmentName: "permit.pdf",
    });
  });

  // A photo of a panel label IS the note. Requiring a sentence beside it would make the shop
  // type "photo" nine hundred times.
  it("a note with a file and no sentence is a real note", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const id = randomUUID();
    await caller.v1.customers.addNote({
      id,
      leadId: leadAId,
      kind: "note",
      body: "",
      attachment: { ...attach(orgAId, leadAId, "panel-label.jpg"), type: "image/jpeg" },
    });
    const { items } = await caller.v1.customers.listNotes({ leadId: leadAId });
    expect(items.find((n) => n.id === id)?.attachmentName).toBe("panel-label.jpg");
  });

  it("a note with neither text nor a file is still refused", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.customers.addNote({ id: randomUUID(), leadId: leadAId, kind: "note", body: "   " }),
    ).rejects.toThrow(TRPCError);
  });

  it("a note whose path points at another customer's folder is refused", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.customers.addNote({
        id: randomUUID(),
        leadId: leadAId,
        kind: "note",
        body: "borrowed",
        attachment: attach(orgAId, otherLeadId),
      }),
    ).rejects.toThrow(TRPCError);
  });

  it("mints the link from the STORED path, not from anything the caller says", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const id = randomUUID();
    const a = attach(orgAId, leadAId);
    await caller.v1.customers.addNote({ id, leadId: leadAId, kind: "note", body: "Permit", attachment: a });

    signedFor.length = 0;
    const { url } = await caller.v1.customers.noteViewUrl({ leadId: leadAId, id });
    expect(signedFor).toEqual([a.path]);
    expect(url).toContain(a.path);
  });

  it("noteUploadUrl keys the object under the customer's own folder", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const objectId = randomUUID();
    const { storagePath } = await caller.v1.customers.noteUploadUrl({ leadId: leadAId, objectId, ext: "jpg" });
    expect(storagePath).toBe(`${orgAId}/leads/${leadAId}/${objectId}.jpg`);
  });

  it("noteUploadUrl answers PRECONDITION_FAILED when storage is unconfigured", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner", null));
    await expect(
      caller.v1.customers.noteUploadUrl({ leadId: leadAId, objectId: randomUUID(), ext: "jpg" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  // ---- The isolation cases this file exists for. ----

  it("another org's caller cannot open org A's attachment", async () => {
    const a = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const id = randomUUID();
    await a.v1.customers.addNote({
      id,
      leadId: leadAId,
      kind: "note",
      body: "Permit",
      attachment: attach(orgAId, leadAId),
    });

    signedFor.length = 0;
    const b = appRouter.createCaller(ctxFor(orgBId, "owner"));
    await expect(b.v1.customers.noteViewUrl({ leadId: leadAId, id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // Not merely refused — never reached the storage layer at all.
    expect(signedFor).toEqual([]);
  });

  it("a note id from a DIFFERENT customer in the same org is not found", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const id = randomUUID();
    await caller.v1.customers.addNote({
      id,
      leadId: leadAId,
      kind: "note",
      body: "Permit",
      attachment: attach(orgAId, leadAId),
    });

    signedFor.length = 0;
    await expect(caller.v1.customers.noteViewUrl({ leadId: otherLeadId, id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(signedFor).toEqual([]);
  });

  it("another org cannot mint an upload key inside org A's customer folder", async () => {
    const b = appRouter.createCaller(ctxFor(orgBId, "owner"));
    await expect(
      b.v1.customers.noteUploadUrl({ leadId: leadAId, objectId: randomUUID(), ext: "jpg" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a note that carries no file reports not-found rather than a broken link", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const id = randomUUID();
    await caller.v1.customers.addNote({ id, leadId: leadAId, kind: "note", body: "just words" });
    await expect(caller.v1.customers.noteViewUrl({ leadId: leadAId, id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("a technician cannot reach the office trail's attachments", async () => {
    const tech = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(
      tech.v1.customers.noteUploadUrl({ leadId: leadAId, objectId: randomUUID(), ext: "jpg" }),
    ).rejects.toThrow(TRPCError);
  });
});
