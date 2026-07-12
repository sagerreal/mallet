import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, systemClock, isOk } from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { OutboxEventBus } from "@mallet/shared/outbox";
import { closeDb } from "@mallet/shared/db/client";
import { appRouter } from "@/trpc/root";
import { asUserId } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import type { AuthProvider, Principal, Role } from "@mallet/identity";
import type { Context } from "@/trpc/init";
import {
  DrizzleInboundEndpointResolver,
  DrizzleInboundEndpointRepository,
  DrizzleLeadReceiptRepository,
  IngestExternalLeadUseCase,
} from "@mallet/inbound";
import { EnsureCustomerUseCase, DrizzleLeadRepository } from "@mallet/customers";
import { AngiLeadParser } from "./parsers/angi-parser";
import { ThumbtackLeadParser } from "./parsers/thumbtack-parser";

// The privileged token→org resolution (no session) + the ingest path (create a lead in the right
// org, idempotency, soft-delete). Complements the router int test (which covers generate/list/
// rotate/disable). Skips when no DB env — never breaks the unit gate.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = { authenticate: async () => { throw new Error("unused"); } };
const ctxFor = (orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: {
    authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator,
    paymentLinkGateway: null, photoStorageGateway: null, llmClient: null,
    apiKeyAuthenticator: { authenticate: async () => null },
    tokenVerifier: { verify: async () => null },
    signupStore: { createOrgForUser: async () => { throw new Error("unused"); } },
  },
});

// Wire the real ingest stack under a tenant tx, exactly as the public route does.
function ingestFor(tx: Parameters<Parameters<typeof withTenant>[1]>[0], orgId: ReturnType<typeof asOrgId>) {
  const bus = new OutboxEventBus(tx, orgId);
  const ensure = new EnsureCustomerUseCase(new DrizzleLeadRepository(tx, orgId), bus, systemClock);
  return new IngestExternalLeadUseCase(
    ensure,
    new DrizzleLeadReceiptRepository(tx, orgId),
    new DrizzleInboundEndpointRepository(tx, orgId),
    systemClock,
  );
}

suite("inbound intake (resolver + ingest, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('InboundIntake A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('InboundIntake B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("resolves an org from its form token (privileged, no session)", async () => {
    const gen = await appRouter.createCaller(ctxFor(orgAId, "owner")).v1.inbound.generate({ channel: "form" });
    const resolved = await new DrizzleInboundEndpointResolver().resolve(gen.token);
    expect(resolved).not.toBeNull();
    expect(resolved!.orgId).toBe(orgAId);
    expect(resolved!.channel).toBe("form");
  });

  it("returns null for an unknown token", async () => {
    const resolved = await new DrizzleInboundEndpointResolver().resolve("a".repeat(64));
    expect(resolved).toBeNull();
  });

  it("ingests a form lead into the resolving org (source=Website), not another org", async () => {
    const orgA = asOrgId(orgAId);
    const outcome = await withTenant(orgA, async (tx) =>
      ingestFor(tx, orgA).exec({
        channel: "form",
        source: "Website",
        lead: { name: "Gary Pratt", phone: "(925) 555-0100", email: "g@x.com", address: "1 Pine", notes: "leak", externalId: null },
      }),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.outcome).toBe("created");

    const inA = await admin<{ n: number }[]>`select count(*)::int as n from leads where org_id = ${orgAId} and name = 'Gary Pratt' and source = 'Website'`;
    expect(inA[0]!.n).toBe(1);
    const inB = await admin<{ n: number }[]>`select count(*)::int as n from leads where org_id = ${orgBId} and name = 'Gary Pratt'`;
    expect(inB[0]!.n).toBe(0);

    // The form channel (externalId=null) must NEVER touch the idempotency ledger.
    const receipts = await admin<{ n: number }[]>`select count(*)::int as n from inbound_lead_receipts where org_id = ${orgAId} and channel = 'form'`;
    expect(receipts[0]!.n).toBe(0);
  });

  it("ingests an Angi lead (source=Angi) and is idempotent on retry (same leadOid → duplicate_ignored, still one lead)", async () => {
    const orgA = asOrgId(orgAId);
    const leadOid = `angi-${randomUUID()}`;
    const parsed = new AngiLeadParser().parse({
      name: "Priya Nair", primaryPhone: "(510) 555-0177", email: "priya@x.com",
      address: "42 Elm St", city: "Fremont", stateProvince: "CA", postalCode: "94536",
      taskName: "Water heater repair", comments: "No hot water", leadOid,
    });
    expect(isOk(parsed)).toBe(true);
    if (!isOk(parsed)) return;
    const lead = parsed.value;

    const first = await withTenant(orgA, (tx) => ingestFor(tx, orgA).exec({ channel: "angi", source: "Angi", lead }));
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.outcome).toBe("created");

    const rows = await admin<{ n: number }[]>`select count(*)::int as n from leads where org_id = ${orgAId} and name = 'Priya Nair' and source = 'Angi'`;
    expect(rows[0]!.n).toBe(1);

    // A real marketplace retry (webhook redelivery) resends the identical payload → same leadOid.
    const second = await withTenant(orgA, (tx) => ingestFor(tx, orgA).exec({ channel: "angi", source: "Angi", lead }));
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.outcome).toBe("duplicate_ignored");

    const rowsAfterRetry = await admin<{ n: number }[]>`select count(*)::int as n from leads where org_id = ${orgAId} and name = 'Priya Nair' and source = 'Angi'`;
    expect(rowsAfterRetry[0]!.n).toBe(1);
    // (The no-re-touch-of-last_lead_at guarantee is asserted at the unit layer via calls.touched===0.)
  });

  it("dedupes a phoneless Angi lead by externalId on retry (phone dedupe alone can't catch this)", async () => {
    const orgA = asOrgId(orgAId);
    const leadOid = `angi-phoneless-${randomUUID()}`;
    const parsed = new AngiLeadParser().parse({
      name: "Devon Cole", taskName: "Drain cleaning", comments: "Slow drain in bathroom", leadOid,
      // No primaryPhone / email on this payload.
    });
    expect(isOk(parsed)).toBe(true);
    if (!isOk(parsed)) return;
    const lead = parsed.value;
    expect(lead.phone).toBeNull();

    const first = await withTenant(orgA, (tx) => ingestFor(tx, orgA).exec({ channel: "angi", source: "Angi", lead }));
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.outcome).toBe("created");

    const second = await withTenant(orgA, (tx) => ingestFor(tx, orgA).exec({ channel: "angi", source: "Angi", lead }));
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.outcome).toBe("duplicate_ignored");

    const rows = await admin<{ n: number }[]>`select count(*)::int as n from leads where org_id = ${orgAId} and name = 'Devon Cole' and source = 'Angi'`;
    expect(rows[0]!.n).toBe(1);
  });

  it("ingests a Thumbtack lead into the resolving org (source=Thumbtack)", async () => {
    const orgA = asOrgId(orgAId);
    const leadID = `tt-${randomUUID()}`;
    const parsed = new ThumbtackLeadParser().parse({
      leadID,
      customer: { name: "Maria Sanchez", phone: "925-555-0142" },
      request: {
        title: "Leaky faucet", description: "Kitchen faucet drips",
        location: { city: "Fremont", state: "CA", zipCode: "94536" },
      },
    });
    expect(isOk(parsed)).toBe(true);
    if (!isOk(parsed)) return;
    const lead = parsed.value;

    const outcome = await withTenant(orgA, (tx) => ingestFor(tx, orgA).exec({ channel: "thumbtack", source: "Thumbtack", lead }));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.outcome).toBe("created");

    const rows = await admin<{ n: number }[]>`select count(*)::int as n from leads where org_id = ${orgAId} and name = 'Maria Sanchez' and source = 'Thumbtack'`;
    expect(rows[0]!.n).toBe(1);
  });

  it("is idempotent on (channel, externalId): reserve is true then false, one receipt row", async () => {
    const orgA = asOrgId(orgAId);
    const ext = `ext-${randomUUID()}`;
    const first = await withTenant(orgA, (tx) => new DrizzleLeadReceiptRepository(tx, orgA).reserve("angi", ext));
    const second = await withTenant(orgA, (tx) => new DrizzleLeadReceiptRepository(tx, orgA).reserve("angi", ext));
    expect(first).toBe(true);
    expect(second).toBe(false);
    const rows = await admin<{ n: number }[]>`select count(*)::int as n from inbound_lead_receipts where org_id = ${orgAId} and channel = 'angi' and external_id = ${ext}`;
    expect(rows[0]!.n).toBe(1);
  });

  it("release rolls back a reservation so a subsequent reserve succeeds again", async () => {
    const orgA = asOrgId(orgAId);
    const ext = `ext-${randomUUID()}`;
    const { first, second } = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleLeadReceiptRepository(tx, orgA);
      const first = await repo.reserve("angi", ext);
      await repo.release("angi", ext);
      const second = await repo.reserve("angi", ext); // released → re-reservable
      return { first, second };
    });
    expect(first).toBe(true);
    expect(second).toBe(true);
    const rows = await admin<{ n: number }[]>`select count(*)::int as n from inbound_lead_receipts where org_id = ${orgAId} and channel = 'angi' and external_id = ${ext}`;
    expect(rows[0]!.n).toBe(1);
  });

  it("does not resolve a soft-deleted endpoint", async () => {
    const caller = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const gen = await caller.v1.inbound.generate({ channel: "form" });
    await caller.v1.inbound.disable({ channel: "form" });
    const resolved = await new DrizzleInboundEndpointResolver().resolve(gen.token);
    expect(resolved).toBeNull();
  });
});
