import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock, ok, err, externalService } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { PhotoStorageGateway } from "@mallet/jobs";
import type { AuthProvider, Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

/**
 * Capstone: exercise the full purchasing stack via createCaller — auth gate, RBAC, org-scoped
 * transaction, use-cases, Drizzle repo, and live RLS — without spinning up HTTP.
 *
 * Mirrors modules/companies/api/company-router.int.test.ts for the CRUD/RBAC/RLS shape and
 * modules/customers/api/lead-note-attachments.int.test.ts for the signed-URL shape.
 */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

/** A storage double that records every path it was asked to sign. */
const signedFor: string[] = [];
const fakeStorage: PhotoStorageGateway = {
  createUploadUrl: vi.fn(async (cmd) => {
    const storagePath = `${cmd.orgId}/${cmd.jobId}/${cmd.objectId}.${cmd.ext}`;
    return ok({ signedUrl: `https://storage.test/upload/${storagePath}`, token: "t", storagePath });
  }),
  download: vi.fn(async () => err(externalService("supabase-storage", "not used here", false))),
  createViewUrl: vi.fn(async (storagePath, ctx) => {
    // Mirror the real adapter's prefix rule so a path outside the order's folder cannot pass
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

const draftInput = (overrides: Record<string, unknown> = {}) => ({
  vendor: "Ferguson",
  jobId: null,
  expectedAt: null,
  shipTo: "counter_pickup" as const,
  ...overrides,
});

suite("purchasing tRPC router (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('PoApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('PoApi B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  // ── org id / RLS isolation ──────────────────────────────────────────────────

  it("never lets a caller set the org id", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await callerA.v1.purchasing.create({
      ...draftInput(),
      // orgId isn't part of the input contract — this proves that even a client that stuffed one
      // in could not reach the use-case with it: the router only ever reads ctx.principal.orgId.
      ...({ orgId: orgBId } as Record<string, unknown>),
    });

    const listedA = await callerA.v1.purchasing.list();
    expect(listedA.items.some((po) => po.id === created.id)).toBe(true);

    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const listedB = await callerB.v1.purchasing.list();
    expect(listedB.items.some((po) => po.id === created.id)).toBe(false);
  });

  it("org B cannot update, place, cancel or remove org A's order (NOT_FOUND via RLS)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await callerA.v1.purchasing.create(draftInput({ vendor: "RLS Boundary Co" }));

    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    await expect(
      callerB.v1.purchasing.update({ poId: created.id, vendor: "Should fail" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(callerB.v1.purchasing.place({ poId: created.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(callerB.v1.purchasing.cancel({ poId: created.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(callerB.v1.purchasing.remove({ poId: created.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── RBAC ─────────────────────────────────────────────────────────────────────

  it("refuses a tech on all ten procedures — purchasing is an office surface end to end", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await callerA.v1.purchasing.create(draftInput());
    const note = await callerA.v1.purchasing.addNote({ poId: created.id, body: "seed note" });

    const tech = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(tech.v1.purchasing.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(tech.v1.purchasing.create(draftInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      tech.v1.purchasing.update({ poId: created.id, vendor: "Nope" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(tech.v1.purchasing.place({ poId: created.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(tech.v1.purchasing.cancel({ poId: created.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(tech.v1.purchasing.remove({ poId: created.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      tech.v1.purchasing.addNote({ poId: created.id, body: "nope" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(tech.v1.purchasing.listNotes({ poId: created.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      tech.v1.purchasing.noteUploadUrl({ poId: created.id, objectId: randomUUID(), ext: "jpg" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      tech.v1.purchasing.noteViewUrl({ poId: created.id, id: note.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── money on the wire ────────────────────────────────────────────────────────

  it("returns money as {cents, currency}, never a bare number", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await caller.v1.purchasing.create(
      draftInput({
        vendor: "Money Shape Co",
        freightCents: 4_200,
        taxCents: 6_890,
        lines: [{ description: "PEX coil", qty: 4, uom: "coil", unitCostMillicents: 8_640_000 }],
      }),
    );

    const dto = await caller.v1.purchasing.list();
    const row = dto.items.find((po) => po.vendor === "Money Shape Co");
    expect(row?.total).toEqual({ cents: expect.any(Number), currency: "USD" });
    expect(row?.freight).toEqual({ cents: 4_200, currency: "USD" });
    expect(row?.tax).toEqual({ cents: 6_890, currency: "USD" });
    // subtotal (4 * $86.40 = $345.60) + freight + tax
    expect(row?.total.cents).toBe(34_560 + 4_200 + 6_890);
    expect(row?.lines[0]?.amount).toEqual({ cents: 34_560, currency: "USD" });
    expect(typeof row?.lines[0]?.unitCostMillicents).toBe("number");
  });

  /**
   * purchase_order_lines.unit_cost_millicents is an int4 column — without a matching zod ceiling,
   * a commercial RTU or boiler line priced over $21,474.83/unit reached Postgres and failed as a
   * raw "integer out of range" 500 instead of a message naming the actual problem. This proves the
   * request never gets past validation at all: BAD_REQUEST, not a database error.
   */
  it("rejects a unit cost over the int4 ceiling as a validation error, not a database 500", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.purchasing.create(
        draftInput({
          vendor: "Overflow Mechanical Co",
          lines: [{ description: "Rooftop RTU", qty: 1, uom: "ea", unitCostMillicents: 2_147_483_648 }],
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // ── lifecycle ──────────────────────────────────────────────────────────────

  it("create → update lines → place → cancel, end to end", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.purchasing.create(
      draftInput({ vendor: "Winsupply", lines: [{ description: "Brass valve", qty: 2, uom: "ea", unitCostMillicents: 1_000_000 }] }),
    );
    expect(created.status).toBe("draft");
    expect(created.num).toBeNull();

    const updated = await caller.v1.purchasing.update({
      poId: created.id,
      lines: [{ description: "Brass valve", qty: 3, uom: "ea", unitCostMillicents: 1_000_000 }],
    });
    expect(updated.lines[0]?.qty).toBe(3);

    const placed = await caller.v1.purchasing.place({ poId: created.id });
    expect(placed.status).toBe("ordered");
    expect(placed.num).toMatch(/^PO-/);
    expect(placed.orderedAt).not.toBeNull();

    const cancelled = await caller.v1.purchasing.cancel({ poId: created.id });
    expect(cancelled.status).toBe("cancelled");
  });

  it("cancelling a draft is refused, telling you to delete it instead (BAD_REQUEST)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.purchasing.create(draftInput({ vendor: "Cancel Draft Co" }));
    await expect(caller.v1.purchasing.cancel({ poId: created.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // ── remove (the SCOPE ADDITION use-case) ────────────────────────────────────

  it("remove soft-deletes a draft; it disappears from list", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.purchasing.create(draftInput({ vendor: "Remove Me Draft" }));

    const result = await caller.v1.purchasing.remove({ poId: created.id });
    expect(result.removed).toBe(true);

    const listed = await caller.v1.purchasing.list();
    expect(listed.items.some((po) => po.id === created.id)).toBe(false);
  });

  it("remove refuses a placed order — cancel it instead — the pair to cancel()'s draft refusal (CONFLICT)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.purchasing.create(
      draftInput({ vendor: "Remove Placed Co", lines: [{ description: "Fitting", qty: 1, uom: "ea", unitCostMillicents: 500_000 }] }),
    );
    const placed = await caller.v1.purchasing.place({ poId: created.id });
    expect(placed.status).toBe("ordered");

    await expect(caller.v1.purchasing.remove({ poId: created.id })).rejects.toMatchObject({ code: "CONFLICT" });

    // Never a hard delete — still there, still ordered, after the refusal.
    const listed = await caller.v1.purchasing.list();
    expect(listed.items.find((po) => po.id === created.id)?.status).toBe("ordered");
  });

  // ── display joins: jobTitle / orderedByName ─────────────────────────────────

  it("resolves jobTitle and orderedByName server-side, batched; orderedByUserId is stamped from the caller", async () => {
    const [lead] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgAId}, 'Jill Vance') returning id`;
    const [job] = await admin<{ id: string }[]>`
      insert into jobs (org_id, num, lead_id, title) values (${orgAId}, 'J-1001', ${lead!.id}, 'Repipe kitchen') returning id`;
    const userId = randomUUID();
    await admin`
      insert into users (id, org_id, auth_user_id, email, name)
      values (${userId}, ${orgAId}, ${randomUUID()}, 'mike@example.com', 'Mike Alvarez')`;

    // orderedByUserId has no client input any more — it is stamped from ctx.principal.userId on
    // create, so the way to make it Mike is to BE Mike.
    const ctx = ctxFor(orgAId, "owner");
    const principal = { ...ctx.principal!, userId: asUserId(userId) };
    const caller = appRouter.createCaller({ ...ctx, principal });

    const created = await caller.v1.purchasing.create(draftInput({ vendor: "Display Join Co", jobId: job!.id }));
    expect(created.orderedByUserId).toBe(userId);
    expect(created.jobTitle).toBe("Repipe kitchen");
    expect(created.orderedByName).toBe("Mike Alvarez");

    const listed = await caller.v1.purchasing.list();
    const row = listed.items.find((po) => po.id === created.id);
    expect(row?.orderedByUserId).toBe(userId);
    expect(row?.jobTitle).toBe("Repipe kitchen");
    expect(row?.orderedByName).toBe("Mike Alvarez");
  });

  it("orderedByUserId cannot be set from client input — a caller cannot claim someone else placed the order", async () => {
    const otherUserId = randomUUID();
    const ctx = ctxFor(orgAId, "owner");
    const callerUserId = ctx.principal!.userId as string;
    const caller = appRouter.createCaller(ctx);

    const created = await caller.v1.purchasing.create(
      draftInput({
        vendor: "No Claiming Co",
        // Not part of the input schema — silently dropped by zod, never reaches the use-case.
        ...({ orderedByUserId: otherUserId } as Record<string, unknown>),
      }),
    );
    expect(created.orderedByUserId).toBe(callerUserId);
    expect(created.orderedByUserId).not.toBe(otherUserId);

    const updated = await caller.v1.purchasing.update({
      poId: created.id,
      vendor: "Still No Claiming Co",
      ...({ orderedByUserId: otherUserId } as Record<string, unknown>),
    });
    expect(updated.orderedByUserId).toBe(callerUserId);
  });

  // ── notes ────────────────────────────────────────────────────────────────────

  it("addNote attributes the AUTHOR to the caller, never to client input", async () => {
    const userId = randomUUID();
    const ctx = ctxFor(orgAId, "owner");
    // Override the principal's userId to a known value so we can assert on it below.
    const principal = { ...ctx.principal!, userId: asUserId(userId) };
    const caller = appRouter.createCaller({ ...ctx, principal });

    const created = await caller.v1.purchasing.create(draftInput({ vendor: "Note Author Co" }));
    const note = await caller.v1.purchasing.addNote({
      poId: created.id,
      body: "Called Ferguson, backordered a week",
      // Even if a client tried to claim a different author, the router never reads it: the input
      // schema has no such field at all.
      ...({ authorUserId: randomUUID() } as Record<string, unknown>),
    });
    expect(note.authorUserId).toBe(userId);

    const { items } = await caller.v1.purchasing.listNotes({ poId: created.id });
    expect(items.find((n) => n.id === note.id)?.body).toBe("Called Ferguson, backordered a week");
  });

  it("a note with a file and no sentence is a real note", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.purchasing.create(draftInput({ vendor: "Note Attachment Co" }));
    const note = await caller.v1.purchasing.addNote({
      poId: created.id,
      body: "",
      attachment: { path: `${orgAId}/purchase-orders/${created.id}/${randomUUID()}.jpg`, type: "image/jpeg", name: "receipt.jpg" },
    });
    expect(note.attachmentName).toBe("receipt.jpg");
  });

  it("mints the link from the STORED path, not from anything the caller says", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.purchasing.create(draftInput({ vendor: "View URL Co" }));
    const path = `${orgAId}/purchase-orders/${created.id}/${randomUUID()}.pdf`;
    const note = await caller.v1.purchasing.addNote({
      poId: created.id,
      body: "Receipt",
      attachment: { path, type: "application/pdf", name: "receipt.pdf" },
    });

    signedFor.length = 0;
    const { url } = await caller.v1.purchasing.noteViewUrl({ poId: created.id, id: note.id });
    expect(signedFor).toEqual([path]);
    expect(url).toContain(path);
  });

  it("noteUploadUrl keys the object under the order's own folder", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.purchasing.create(draftInput({ vendor: "Upload URL Co" }));
    const objectId = randomUUID();
    const { storagePath } = await caller.v1.purchasing.noteUploadUrl({ poId: created.id, objectId, ext: "jpg" });
    expect(storagePath).toBe(`${orgAId}/purchase-orders/${created.id}/${objectId}.jpg`);
  });

  it("noteUploadUrl answers PRECONDITION_FAILED when storage is unconfigured", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner", null));
    const created = await caller.v1.purchasing.create(draftInput({ vendor: "No Storage Co" }));
    await expect(
      caller.v1.purchasing.noteUploadUrl({ poId: created.id, objectId: randomUUID(), ext: "jpg" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("another org cannot mint an upload key inside org A's order folder", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await callerA.v1.purchasing.create(draftInput({ vendor: "Foreign Upload Co" }));

    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    await expect(
      callerB.v1.purchasing.noteUploadUrl({ poId: created.id, objectId: randomUUID(), ext: "jpg" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("another org's caller cannot open org A's attachment", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await callerA.v1.purchasing.create(draftInput({ vendor: "Foreign View Co" }));
    const note = await callerA.v1.purchasing.addNote({
      poId: created.id,
      body: "Receipt",
      attachment: { path: `${orgAId}/purchase-orders/${created.id}/${randomUUID()}.pdf`, type: "application/pdf", name: "r.pdf" },
    });

    signedFor.length = 0;
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    await expect(
      callerB.v1.purchasing.noteViewUrl({ poId: created.id, id: note.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Not merely refused — never reached the storage layer at all.
    expect(signedFor).toEqual([]);
  });

  it("a soft-deleted order's notes stop being servable — listNotes and noteViewUrl both answer NOT_FOUND", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.purchasing.create(draftInput({ vendor: "Removed Order Notes Co" }));
    const note = await caller.v1.purchasing.addNote({
      poId: created.id,
      body: "Receipt",
      attachment: { path: `${orgAId}/purchase-orders/${created.id}/${randomUUID()}.pdf`, type: "application/pdf", name: "r.pdf" },
    });

    const removed = await caller.v1.purchasing.remove({ poId: created.id });
    expect(removed.removed).toBe(true);

    signedFor.length = 0;
    await expect(caller.v1.purchasing.listNotes({ poId: created.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller.v1.purchasing.noteViewUrl({ poId: created.id, id: note.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Never reached the storage layer once the order-existence guard refused it.
    expect(signedFor).toEqual([]);
  });
});
