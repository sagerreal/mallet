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
import { requestChangePublicQuote } from "@/modules/quoting/app/public-quote";

// Capstone: the whole quoting stack via createCaller — auth, RBAC, org-scoped tx, use-cases,
// Drizzle repo, live RLS. Owner in org A drafts -> sends -> accepts; org B sees nothing; a tech
// is forbidden.
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
  deps: { authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator, paymentLinkGateway: null, photoStorageGateway: null, llmClient: null, apiKeyAuthenticator: { authenticate: async () => null }, tokenVerifier: { verify: async () => null }, signupStore: { createOrgForUser: async () => { throw new Error("unused in this test"); } } },
});

suite("quoting tRPC router (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('QuoteApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('QuoteApi B ' || gen_random_uuid()) returning id`;
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

  it("owner drafts, sends, and accepts an estimate with correct totals", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const drafted = await caller.v1.quoting.draft({
      leadId: leadAId,
      title: "Deck rebuild",
      taxBps: 1_000, // 10%
      depBps: 5_000, // 50%
      lines: [
        { description: "Labor", quantity: 10, rateCents: 10_000 }, // 100000c
        { description: "Optional sealant", quantity: 1, rateCents: 5_000, isOptional: true },
      ],
    });
    expect(drafted.status).toBe("draft");
    expect(drafted.num).toMatch(/^EST-\d+$/);
    expect(drafted.subtotal.cents).toBe(100_000); // optional line excluded
    expect(drafted.tax.cents).toBe(10_000);
    expect(drafted.total.cents).toBe(110_000);
    expect(drafted.depositDue.cents).toBe(55_000);

    const sent = await caller.v1.quoting.send({ estimateId: drafted.id });
    expect(sent.status).toBe("sent");

    const accepted = await caller.v1.quoting.accept({ estimateId: drafted.id });
    expect(accepted.status).toBe("accepted");

    const fetched = await caller.v1.quoting.get({ estimateId: drafted.id });
    expect(fetched.total.cents).toBe(110_000);

    const listed = await caller.v1.quoting.list({ limit: 50 });
    expect(listed.items.some((e) => e.id === drafted.id)).toBe(true);
  });

  it("a different org sees no estimates", async () => {
    const caller = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const listed = await caller.v1.quoting.list({ limit: 50 });
    expect(listed.items).toHaveLength(0);
  });

  it("a tech is forbidden from the quoting API", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(
      caller.v1.quoting.draft({ leadId: leadAId, lines: [{ description: "x", quantity: 1, rateCents: 1 }] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("accept creates a job automatically (idempotent)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));

    // Draft + send + accept
    const drafted = await caller.v1.quoting.draft({
      leadId: leadAId,
      title: "Auto-job test",
      lines: [{ description: "Labor", quantity: 2, rateCents: 15_000 }],
    });
    await caller.v1.quoting.send({ estimateId: drafted.id });
    const accepted = await caller.v1.quoting.accept({ estimateId: drafted.id });
    expect(accepted.status).toBe("accepted");

    // A job should exist for this lead — use listByLead since jobSummaryDTO lacks sourceEstimateId.
    // Then fetch the full job to verify sourceEstimateId.
    const jobsPage = await caller.v1.jobs.listByLead({ leadId: leadAId, limit: 50 });
    expect(jobsPage.items.length).toBeGreaterThan(0);

    // Find the job whose full DTO has sourceEstimateId matching our estimate.
    let matchingJobId: string | undefined;
    for (const summary of jobsPage.items) {
      const full = await caller.v1.jobs.get({ jobId: summary.id });
      if (full.sourceEstimateId === drafted.id) {
        matchingJobId = full.id;
        expect(full.status).toMatch(/^(unscheduled|scheduled)$/);
        break;
      }
    }
    expect(matchingJobId).toBeDefined();

    // Re-accept on an already-accepted estimate throws a validation error (domain rule).
    // The important thing is that only ONE job exists for this estimate.
    await expect(caller.v1.quoting.accept({ estimateId: drafted.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const jobsAgain = await caller.v1.jobs.listByLead({ leadId: leadAId, limit: 50 });
    let matchCount = 0;
    for (const summary of jobsAgain.items) {
      const full = await caller.v1.jobs.get({ jobId: summary.id });
      if (full.sourceEstimateId === drafted.id) matchCount++;
    }
    expect(matchCount).toBe(1);
  });

  it("archiving a lead archives its estimates (cascade)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));

    // Create a fresh lead for isolation (avoids interference with other tests).
    const lead = await caller.v1.customers.create({ name: "Archive Test Customer" });

    // Draft + send an estimate for it.
    const drafted = await caller.v1.quoting.draft({
      leadId: lead.id,
      title: "Cascade test",
      lines: [{ description: "Work", quantity: 1, rateCents: 10_000 }],
    });
    await caller.v1.quoting.send({ estimateId: drafted.id });

    // Archive the lead — this should cascade the estimate soft-delete.
    await caller.v1.customers.archive({ leadId: lead.id });

    // The estimate should no longer appear in the list (soft-deleted by cascade).
    const estimates = await caller.v1.quoting.list({ limit: 50 });
    expect(estimates.items.find((e) => e.id === drafted.id)).toBeUndefined();

    // listByLead should also return 0 since the estimate is soft-deleted.
    const byLead = await caller.v1.quoting.listByLead({ leadId: lead.id, limit: 10 });
    expect(byLead.items).toHaveLength(0);
  });

  it("archiving a lead does NOT archive accepted estimates (M3: cascade scope)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));

    // Fresh lead for isolation.
    const lead = await caller.v1.customers.create({ name: "Accepted Cascade Test Customer" });

    // Draft + send + accept an estimate.
    const drafted = await caller.v1.quoting.draft({
      leadId: lead.id,
      title: "Accepted cascade test",
      lines: [{ description: "Won work", quantity: 1, rateCents: 20_000 }],
    });
    await caller.v1.quoting.send({ estimateId: drafted.id });
    const accepted = await caller.v1.quoting.accept({ estimateId: drafted.id });
    expect(accepted.status).toBe("accepted");

    // Also create a declined estimate for the same lead.
    const drafted2 = await caller.v1.quoting.draft({
      leadId: lead.id,
      title: "Declined estimate",
      lines: [{ description: "Rejected work", quantity: 1, rateCents: 5_000 }],
    });
    await caller.v1.quoting.send({ estimateId: drafted2.id });
    await caller.v1.quoting.decline({ estimateId: drafted2.id, reason: "Too expensive" });

    // Archive the lead — should cascade-delete declined but NOT accepted estimates.
    await caller.v1.customers.archive({ leadId: lead.id });

    // The accepted estimate should still be queryable directly (not soft-deleted).
    const fetched = await caller.v1.quoting.get({ estimateId: accepted.id });
    expect(fetched.status).toBe("accepted");
  });

  it("listByLead returns only that lead's estimates; cross-org RLS blocks other org", async () => {
    // Create a second lead in org A to verify filtering works within the same org.
    const [extraRow] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgAId}, 'Cust A extra') returning id`;
    const leadExtraId = extraRow!.id;

    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));

    // Draft an estimate for the primary lead (leadAId).
    const estForA = await callerA.v1.quoting.draft({
      leadId: leadAId,
      lines: [{ description: "Paint", quantity: 1, rateCents: 20_000 }],
    });

    // Draft an estimate for the second lead — must not leak into leadAId results.
    const estForExtra = await callerA.v1.quoting.draft({
      leadId: leadExtraId,
      lines: [{ description: "Clean", quantity: 1, rateCents: 8_000 }],
    });

    // listByLead scoped to leadAId returns estForA but not estForExtra.
    const pageA = await callerA.v1.quoting.listByLead({ leadId: leadAId });
    expect(pageA.items.some((e) => e.id === estForA.id)).toBe(true);
    expect(pageA.items.every((e) => e.leadId === leadAId)).toBe(true);
    expect(pageA.items.some((e) => e.id === estForExtra.id)).toBe(false);

    // Org B caller sees nothing for leadAId (RLS).
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const pageB = await callerB.v1.quoting.listByLead({ leadId: leadAId });
    expect(pageB.items).toHaveLength(0);
  });

  it("customer requests a change on a sent quote via the public token", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));

    // Fresh lead for isolation (the task assertion counts rows on this lead).
    const lead = await caller.v1.customers.create({ name: "Change Request Customer" });
    const drafted = await caller.v1.quoting.draft({
      leadId: lead.id,
      title: "Fence repair",
      lines: [{ description: "Labor", quantity: 4, rateCents: 12_000 }],
    });
    const sent = await caller.v1.quoting.send({ estimateId: drafted.id });
    expect(sent.publicToken).toBeTruthy();

    // The public page path: request a change through the token (no auth).
    const changed = await requestChangePublicQuote(sent.publicToken!, "  Please lower the price  ");
    expect(changed.kind).toBe("ok");
    if (changed.kind !== "ok") throw new Error("expected ok");
    expect(changed.estimate.props.status).toBe("sent"); // stays sent — office decides what happens next
    expect(changed.estimate.props.changeRequest).toBe("Please lower the price"); // trimmed
    expect(changed.estimate.props.changeRequestedAt).toBeInstanceOf(Date);

    // The office sees it on the DTO.
    const fetched = await caller.v1.quoting.get({ estimateId: drafted.id });
    expect(fetched.changeRequest).toBe("Please lower the price");
    expect(fetched.changeRequestedAt).not.toBeNull();

    // A task was created on the lead so the office is notified.
    const tasks = await admin<{ text: string }[]>`
      select text from tasks where org_id = ${orgAId} and lead_id = ${lead.id}`;
    expect(tasks.some((t) => t.text.includes("change requested"))).toBe(true);
  });

  it("request_change on a non-sent quote is refused: state and fields unchanged", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));

    const drafted = await caller.v1.quoting.draft({
      leadId: leadAId,
      title: "Too-late change",
      lines: [{ description: "Work", quantity: 1, rateCents: 9_000 }],
    });
    const sent = await caller.v1.quoting.send({ estimateId: drafted.id });
    await caller.v1.quoting.accept({ estimateId: drafted.id });

    // Accepted quote → domain rejects; the idempotent "not_sent" path returns current state.
    const result = await requestChangePublicQuote(sent.publicToken!, "actually, change it");
    expect(result.kind).toBe("not_sent");
    if (result.kind !== "not_sent") throw new Error("expected not_sent");
    expect(result.estimate).not.toBeNull();
    expect(result.estimate!.props.status).toBe("accepted");
    expect(result.estimate!.props.changeRequest ?? null).toBeNull();

    // A token that matches nothing → not_found.
    const missing = await requestChangePublicQuote("not-a-real-token", "hello");
    expect(missing.kind).toBe("not_found");
  });
});
