import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { AuthProvider, Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

/**
 * The customer activity trail, through the whole stack against live RLS.
 *
 * These notes hold free text a customer told the shop — gate codes, access instructions, what a
 * call was about. That makes cross-tenant leakage a disclosure of the customer's own words, so
 * the isolation assertions here are the point of the file, not a formality.
 *
 * The bug that prompted it: notes lived only in the browser's store, so a gate code typed into a
 * customer's Notes composer vanished on the next refetch.
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

suite("customer notes (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('NoteTest A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('NoteTest B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;

    const lead = await appRouter
      .createCaller(ctxFor(orgAId, "owner"))
      .v1.customers.create({ name: "Jill Vance", phone: "(555) 213-9001" });
    leadAId = lead.id;
  });

  afterAll(async () => {
    // orgs cascade to leads, and lead_notes cascades from orgs — one delete drains the tree.
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("a note survives the round-trip — the bug this closes", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const id = randomUUID();
    await caller.v1.customers.addNote({ id, leadId: leadAId, kind: "note", body: "Gate code 4482" });

    const { items } = await caller.v1.customers.listNotes({ leadId: leadAId });
    expect(items.find((n) => n.id === id)?.body).toBe("Gate code 4482");
  });

  it("keeps the client-authored id, so the Undo can target this exact row", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const id = randomUUID();
    const created = await caller.v1.customers.addNote({ id, leadId: leadAId, kind: "note", body: "Dog in the yard" });
    expect(created.id).toBe(id);
  });

  it("stores a call's full shape, not just its text", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const id = randomUUID();
    await caller.v1.customers.addNote({
      id, leadId: leadAId, kind: "call", body: "",
      direction: "out", outcome: "No answer", durationLabel: "0:12", via: "mobile",
    });
    const { items } = await caller.v1.customers.listNotes({ leadId: leadAId });
    expect(items.find((n) => n.id === id)).toMatchObject({
      kind: "call", direction: "out", outcome: "No answer", durationLabel: "0:12", via: "mobile",
    });
  });

  it("returns the trail oldest-first — the order the feed renders", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const { items } = await caller.v1.customers.listNotes({ leadId: leadAId });
    const stamps = items.map((n) => new Date(n.createdAt).getTime());
    expect([...stamps].sort((x, y) => x - y)).toEqual(stamps);
  });

  it("a removed note leaves the trail", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const id = randomUUID();
    await caller.v1.customers.addNote({ id, leadId: leadAId, kind: "text", body: "On our way", author: "us" });
    await caller.v1.customers.removeNote({ noteId: id });

    const { items } = await caller.v1.customers.listNotes({ leadId: leadAId });
    expect(items.some((n) => n.id === id)).toBe(false);
  });

  it("is a SOFT delete — the row is still there, just not returned", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const id = randomUUID();
    await caller.v1.customers.addNote({ id, leadId: leadAId, kind: "note", body: "retract me" });
    await caller.v1.customers.removeNote({ noteId: id });

    const rows = await admin<{ deleted_at: Date | null }[]>`
      select deleted_at from lead_notes where id = ${id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deleted_at).not.toBeNull();
  });

  it("refuses a second delete rather than reporting a success that did nothing", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const id = randomUUID();
    await caller.v1.customers.addNote({ id, leadId: leadAId, kind: "note", body: "once" });
    await caller.v1.customers.removeNote({ noteId: id });
    await expect(caller.v1.customers.removeNote({ noteId: id })).rejects.toThrow(TRPCError);
  });

  // ---- Tenant isolation. These notes are the customer's own words. ----

  it("another org cannot READ org A's notes", async () => {
    const a = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const id = randomUUID();
    await a.v1.customers.addNote({ id, leadId: leadAId, kind: "note", body: "Gate code 4482" });

    const b = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const { items } = await b.v1.customers.listNotes({ leadId: leadAId });
    expect(items).toHaveLength(0);
  });

  it("another org cannot WRITE a note onto org A's customer", async () => {
    const b = appRouter.createCaller(ctxFor(orgBId, "owner"));
    await expect(
      b.v1.customers.addNote({ id: randomUUID(), leadId: leadAId, kind: "note", body: "injected" }),
    ).rejects.toThrow(TRPCError);
  });

  it("another org cannot DELETE org A's note", async () => {
    const a = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const id = randomUUID();
    await a.v1.customers.addNote({ id, leadId: leadAId, kind: "note", body: "mine" });

    const b = appRouter.createCaller(ctxFor(orgBId, "owner"));
    await expect(b.v1.customers.removeNote({ noteId: id })).rejects.toThrow(TRPCError);

    // …and it is still there for org A.
    const { items } = await a.v1.customers.listNotes({ leadId: leadAId });
    expect(items.some((n) => n.id === id)).toBe(true);
  });

  it("a technician cannot reach the office trail", async () => {
    const tech = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(tech.v1.customers.listNotes({ leadId: leadAId })).rejects.toThrow(TRPCError);
  });
});
