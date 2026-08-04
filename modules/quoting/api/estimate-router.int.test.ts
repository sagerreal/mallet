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
import { acceptPublicQuote, declinePublicQuote, requestChangePublicQuote } from "@/modules/quoting/app/public-quote";
import { recordEstimateDeposit } from "@/modules/quoting/app/public-quote-deposit";
import { withTenant } from "@mallet/shared/db/tx";
import { sql as sqlRaw } from "drizzle-orm";
import { asEstimateId } from "@mallet/shared/types";
import { DrizzleEstimateDepositLedger } from "@/modules/quoting/infra/drizzle-estimate-deposit-ledger";
import { GET as publicQuoteGET } from "@/app/api/public/quote/[token]/route";

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
  deps: { authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator, paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null, llmClient: null, apiKeyAuthenticator: { authenticate: async () => null }, tokenVerifier: { verify: async () => null }, signupStore: { createOrgForUser: async () => { throw new Error("unused in this test"); } } },
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

    // Fix 2: the accept response must carry the created job in the "job" field so
    // the client can adopt it immediately without a separate network call.
    expect(accepted.job).not.toBeNull();
    expect(accepted.job).toBeDefined();
    // jobSummaryDTO does not expose sourceEstimateId directly, but we can verify
    // the job id by cross-referencing with the full DTO.
    const jobId = accepted.job!.id;
    // The auto-created job starts with ONE unplaced default-length (2h) visit so the job
    // modal always shows an editable Length row and the schedule tray's "2h" is real data.
    expect(accepted.job!.visits).toHaveLength(1);
    expect(accepted.job!.visits[0]!.durationMinutes).toBe(120);
    const fullJob = await caller.v1.jobs.get({ jobId });
    expect(fullJob.sourceEstimateId).toBe(drafted.id);
    // Persisted, not a phantom: the visit survives a re-fetch from the DB (insertForEstimate
    // must write job_visits, or the next hydrator sweep would remove it).
    expect(fullJob.visits).toHaveLength(1);
    expect(fullJob.visits[0]!.durationMinutes).toBe(120);

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

  it("accept with jobId CONVERTS the scope-visit job — same job flips to work, no duplicate row", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Convert Test Customer" });

    // The walkthrough already on the books: a kind='estimate' job for this lead.
    const scopeJob = await caller.v1.jobs.create({
      leadId: lead.id,
      title: "Walkthrough",
      kind: "estimate",
    });
    expect(scopeJob.kind).toBe("estimate");
    const walkthroughVisits = scopeJob.visits.length;

    // The composer's draft carries the scope-visit job; the DTO reads it back.
    const drafted = await caller.v1.quoting.draft({
      leadId: lead.id,
      title: "Repipe",
      taxBps: 1_000, // 10%
      lines: [{ description: "Repipe supply lines", quantity: 1, rateCents: 200_000 }],
      jobId: scopeJob.id,
    });
    expect(drafted.jobId).toBe(scopeJob.id);
    await caller.v1.quoting.send({ estimateId: drafted.id });
    const accepted = await caller.v1.quoting.accept({ estimateId: drafted.id });

    // The SAME job came back, converted — not a second job minted next to the walkthrough.
    expect(accepted.job).not.toBeNull();
    expect(accepted.job!.id).toBe(scopeJob.id);
    expect(accepted.job!.kind).toBe("work");

    const full = await caller.v1.jobs.get({ jobId: scopeJob.id });
    expect(full.kind).toBe("work");
    expect(full.sourceEstimateId).toBe(drafted.id);
    expect(full.title).toBe("Repipe");
    expect(full.svc).toBeNull(); // stale estimate signal cleared, same as the mint path
    expect(full.total!.cents).toBe(220_000); // tax-inclusive snapshot
    expect(full.status).toBe("scheduled"); // live work again, not "done, not billed"
    // The sold scope landed on the job. Read straight off the table — v1.jobs.get returns the
    // header + visits only (execution lines ride their own batched reads).
    const lineRows = await admin<{ description: string }[]>`
      select description from job_lines where job_id = ${scopeJob.id} and deleted_at is null`;
    expect(lineRows.map((r) => r.description)).toEqual(["Repipe supply lines"]);
    // ONE pending visit appended AFTER the walkthrough's — history preserved, positions ordered.
    expect(full.visits).toHaveLength(walkthroughVisits + 1);
    const appended = full.visits[full.visits.length - 1]!;
    expect(appended.status).toBe("pending");
    expect(appended.durationMinutes).toBe(120);

    // Exactly ONE job row for this lead — the assertion the whole task exists for.
    const jobsPage = await caller.v1.jobs.listByLead({ leadId: lead.id, limit: 50 });
    expect(jobsPage.items).toHaveLength(1);

    // Re-running the job-creation path (the manual fallback endpoint) is idempotent:
    // same job id, and no second pending visit gets seeded onto it.
    const again = await caller.v1.jobs.createFromEstimate({ estimateId: drafted.id });
    expect(again.id).toBe(scopeJob.id);
    const reloaded = await caller.v1.jobs.get({ jobId: scopeJob.id });
    expect(reloaded.visits).toHaveLength(walkthroughVisits + 1);
  });

  it("cross-tenant jobId is refused at draft — org B cannot claim org A's walkthrough", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const leadA = await callerA.v1.customers.create({ name: "Tenant A Walkthrough Customer" });
    const scopeJobA = await callerA.v1.jobs.create({
      leadId: leadA.id,
      title: "Walkthrough A",
      kind: "estimate",
    });

    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const leadB = await callerB.v1.customers.create({ name: "Tenant B Customer" });
    // The org-scoped job read cannot see org A's row → refused as a validation error,
    // never stored (no mangled cross-tenant link, no FK explosion).
    await expect(
      callerB.v1.quoting.draft({
        leadId: leadB.id,
        lines: [{ description: "Steal", quantity: 1, rateCents: 1_000 }],
        jobId: scopeJobA.id,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a quote cannot claim existing WORK at draft — jobId must point at an estimate visit", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Work Job Guard Customer" });
    const workJob = await caller.v1.jobs.create({ leadId: lead.id, title: "Real work" }); // kind defaults to 'work'
    await expect(
      caller.v1.quoting.draft({
        leadId: lead.id,
        lines: [{ description: "Grab", quantity: 1, rateCents: 1_000 }],
        jobId: workJob.id,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
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

  it("customer accepts via the public token with a selected optional add-on — total and deposit reflect the selection", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));

    // Fresh lead for isolation. Odd-cent pricing so every rounding step is exercised:
    // fixed 3 × $33.33 = 9_999c; optional 1.5 × $9.99 = round(1498.5) = 1_499c;
    // disc 10%, tax 8.25%, dep 33% → tuned total 11_202c, deposit 3_697c.
    const lead = await caller.v1.customers.create({ name: "Addon Accept Customer" });
    const drafted = await caller.v1.quoting.draft({
      leadId: lead.id,
      title: "Water heater",
      discBps: 1_000,
      taxBps: 825,
      depBps: 3_300,
      lines: [
        { description: "Labor", quantity: 3, rateCents: 3_333 },
        { description: "Optional anode rod", quantity: 1.5, rateCents: 999, isOptional: true },
      ],
    });
    const sent = await caller.v1.quoting.send({ estimateId: drafted.id });
    expect(sent.publicToken).toBeTruthy();
    const optLine = sent.lines.find((l) => l.isOptional);
    expect(optLine).toBeDefined();

    // The public page path: accept through the token with the add-on toggled ON.
    const result = await acceptPublicQuote(sent.publicToken!, [optLine!.id]);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.estimate.props.status).toBe("accepted");
    expect(result.estimate.total()).toBe(11_202);
    // The deposit ASK derives from the COMMITTED (tuned) lines; depPaid stays 0 —
    // accepting agrees to the work, it pays nothing.
    expect(result.estimate.depositDue()).toBe(3_697);
    expect(result.estimate.props.depPaid).toBe(0);
    expect(result.estimate.props.lines.every((l) => !l.props.isOptional)).toBe(true);

    // Stored state matches what was returned: the office sees the tuned total.
    const fetched = await caller.v1.quoting.get({ estimateId: drafted.id });
    expect(fetched.status).toBe("accepted");
    expect(fetched.total.cents).toBe(11_202);
    expect(fetched.lines).toHaveLength(2);
    expect(fetched.lines.every((l) => !l.isOptional)).toBe(true);
  });

  it("accept with an invalid selection id is rejected and the estimate stays sent", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));

    const lead = await caller.v1.customers.create({ name: "Bad Selection Customer" });
    const drafted = await caller.v1.quoting.draft({
      leadId: lead.id,
      title: "Bad selection test",
      lines: [
        { description: "Labor", quantity: 1, rateCents: 50_000 },
        { description: "Optional extra", quantity: 1, rateCents: 7_500, isOptional: true },
      ],
    });
    const sent = await caller.v1.quoting.send({ estimateId: drafted.id });

    // An id that names no stored OPTIONAL line → invalid_selection, nothing committed.
    const invalid = await acceptPublicQuote(sent.publicToken!, [randomUUID()]);
    expect(invalid.kind).toBe("invalid_selection");
    const afterInvalid = await caller.v1.quoting.get({ estimateId: drafted.id });
    expect(afterInvalid.status).toBe("sent");
    expect(afterInvalid.total.cents).toBe(50_000);

    // A fixed (non-optional) line id is also not toggleable.
    const fixedLine = sent.lines.find((l) => !l.isOptional);
    const nonOptional = await acceptPublicQuote(sent.publicToken!, [fixedLine!.id]);
    expect(nonOptional.kind).toBe("invalid_selection");

    // Accept with NO selection still works — the optional line stays excluded.
    const accepted = await acceptPublicQuote(sent.publicToken!);
    expect(accepted.kind).toBe("ok");
    if (accepted.kind !== "ok") throw new Error("expected ok");
    expect(accepted.estimate.total()).toBe(50_000);
  });

  // -------------------------------------------------------------------------
  // Good/Better/Best
  // -------------------------------------------------------------------------

  const GBB_TIER_NAMES = { good: "Patch", better: "Repair", best: "Replace" };

  const draftGbb = async (caller: ReturnType<typeof appRouter.createCaller>, leadId: string) =>
    caller.v1.quoting.draft({
      leadId,
      title: "Sewer line",
      taxBps: 1_000, // 10%
      depBps: 5_000, // 50%
      recommendedTier: "better",
      tierNames: GBB_TIER_NAMES,
      termsSnapshot: "Net 15. Workmanship warranty: 1 year.",
      lines: [
        { description: "Patch leak", quantity: 1, rateCents: 20_000, tier: "good" },
        { description: "Repair section", quantity: 1, rateCents: 35_000, tier: "better" },
        { description: "Camera inspection", quantity: 1, rateCents: 5_000, isOptional: true, tier: "better" },
        { description: "Replace run", quantity: 1, rateCents: 90_000, tier: "best" },
      ],
    });

  it("GBB lifecycle: tiers persist, totals follow the recommended tier, the customer's pick resolves the quote, the job reads the resolved total", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "GBB Customer" });
    const drafted = await draftGbb(caller, lead.id);

    // Draft DTO carries the tier structure.
    expect(drafted.recommendedTier).toBe("better");
    expect(drafted.acceptedTier).toBeNull();
    expect(drafted.tierNames).toEqual(GBB_TIER_NAMES);
    expect(drafted.termsSnapshot).toContain("Net 15");
    expect(drafted.lines.map((l) => l.tier)).toEqual(["good", "better", "better", "best"]);
    // Totals derive from the RECOMMENDED tier's fixed lines: 35_000 + 10% tax.
    expect(drafted.subtotal.cents).toBe(35_000);
    expect(drafted.total.cents).toBe(38_500);
    expect(drafted.depositDue.cents).toBe(19_250);
    // Summary totals agree (list views show the recommended tier's figure).
    const listed = await caller.v1.quoting.listByLead({ leadId: lead.id, limit: 10 });
    expect(listed.items.find((e) => e.id === drafted.id)?.total.cents).toBe(38_500);
    expect(listed.items.find((e) => e.id === drafted.id)?.recommendedTier).toBe("better");

    const sent = await caller.v1.quoting.send({ estimateId: drafted.id });
    expect(sent.publicToken).toBeTruthy();
    const optId = sent.lines.find((l) => l.isOptional && l.tier === "better")!.id;
    const goodFixedId = sent.lines.find((l) => l.tier === "good")!.id;

    // A fixed line id — even from another tier — is not toggleable.
    const badSelection = await acceptPublicQuote(sent.publicToken!, [goodFixedId], "better");
    expect(badSelection.kind).toBe("invalid_selection");

    // The customer picks Better + the camera add-on.
    const result = await acceptPublicQuote(sent.publicToken!, [optId], "better");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.estimate.props.status).toBe("accepted");
    expect(result.estimate.props.acceptedTier).toBe("better");
    // Committed lines = the chosen tier's fixed line + the selected add-on, resolved.
    expect(result.estimate.props.lines).toHaveLength(2);
    expect(
      result.estimate.props.lines.every((l) => l.props.tier === null && !l.props.isOptional),
    ).toBe(true);
    expect(result.estimate.total()).toBe(44_000); // (35_000 + 5_000) + 10% tax
    expect(result.estimate.depositDue()).toBe(22_000);
    expect(result.estimate.props.depPaid).toBe(0); // agreed, not paid

    // The office sees the resolved quote.
    const fetched = await caller.v1.quoting.get({ estimateId: drafted.id });
    expect(fetched.status).toBe("accepted");
    expect(fetched.acceptedTier).toBe("better");
    expect(fetched.total.cents).toBe(44_000);
    expect(fetched.lines).toHaveLength(2);

    // The auto-created job reads the RESOLVED (chosen-tier) total, not the recommended one.
    const jobsPage = await caller.v1.jobs.listByLead({ leadId: lead.id, limit: 50 });
    let jobTotalCents: number | undefined;
    for (const summary of jobsPage.items) {
      const full = await caller.v1.jobs.get({ jobId: summary.id });
      if (full.sourceEstimateId === drafted.id) {
        jobTotalCents = full.total?.cents;
        break;
      }
    }
    expect(jobTotalCents).toBe(44_000);
  });

  it("a signed accept reaches the OFFICE through quoting.get — the evidence is readable, not write-only", async () => {
    // The gap that made the first cut of this feature useless: the signature landed in Postgres
    // and no authenticated surface could read it back, so the only way to produce it was a SQL
    // console. This asserts the whole round trip: public signature in, office DTO out.
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Signature Readback Customer" });
    const drafted = await caller.v1.quoting.draft({
      leadId: lead.id,
      title: "Water heater",
      depBps: 2_500,
      lines: [{ description: "Water heater swap", quantity: 1, rateCents: 2_000_000 }],
    });
    const sent = await caller.v1.quoting.send({ estimateId: drafted.id });

    const result = await acceptPublicQuote(sent.publicToken!, undefined, undefined, {
      signerName: "Dave Chen",
      signatureSvg: "M10,10 L40,30",
      signerIp: "203.0.113.9",
      signerUserAgent: "Mozilla/5.0 (iPhone)",
    });
    expect(result.kind).toBe("ok");

    const fetched = await caller.v1.quoting.get({ estimateId: drafted.id });
    expect(fetched.signature).not.toBeNull();
    expect(fetched.signature!.signerName).toBe("Dave Chen");
    expect(fetched.signature!.signatureSvg).toBe("M10,10 L40,30");
    expect(fetched.signature!.signerIp).toBe("203.0.113.9");
    expect(fetched.signature!.signedAt).toBeTruthy();

    // The snapshot is the frozen document — the amount and the sentence a shop would produce.
    expect(fetched.signature!.snapshot.totalCents).toBe(2_000_000);
    expect(fetched.signature!.snapshot.depositCents).toBe(500_000);
    expect(fetched.signature!.snapshot.estimateNum).toBe(fetched.num);
    expect(fetched.signature!.snapshot.authorizationText).toMatch(/both the quote and the final bill/i);
    expect(fetched.signature!.snapshot.lines).toHaveLength(1);
  });

  it("an OFFICE accept carries no signature — accepted is not the same as signed", async () => {
    // A phone approval the office marked itself is a real acceptance with no evidence behind it.
    // Returning a signature-shaped object here would let the UI print "Signed" over nothing, which
    // is the failure mode that made the office pill lie before this change.
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Phone Approval Customer" });
    const drafted = await caller.v1.quoting.draft({
      leadId: lead.id,
      title: "Phone approval",
      lines: [{ description: "Service call", quantity: 1, rateCents: 25_000 }],
    });
    await caller.v1.quoting.send({ estimateId: drafted.id });
    const accepted = await caller.v1.quoting.accept({ estimateId: drafted.id });

    expect(accepted.status).toBe("accepted");
    expect(accepted.signature).toBeNull();
    expect((await caller.v1.quoting.get({ estimateId: drafted.id })).signature).toBeNull();
  });

  it("the PUBLIC route never reflects the signature back to the token holder", async () => {
    // The IP and user agent are captured ABOUT the customer. Handing them back to anyone holding
    // the link would turn evidence into a disclosure — and the link is the only credential.
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Public Readback Customer" });
    const drafted = await caller.v1.quoting.draft({
      leadId: lead.id,
      title: "Leak repair",
      lines: [{ description: "Repair", quantity: 1, rateCents: 40_000 }],
    });
    const sent = await caller.v1.quoting.send({ estimateId: drafted.id });
    await acceptPublicQuote(sent.publicToken!, undefined, undefined, {
      signerName: "Dave Chen",
      signatureSvg: "M1,1 L2,2",
      signerIp: "203.0.113.9",
      signerUserAgent: "Mozilla/5.0",
    });

    // Assert on the HTTP RESPONSE, not on getPublicQuote's return. The app-layer read hands back
    // the domain aggregate, which necessarily carries every column; what protects the customer is
    // the route's serialiser choosing not to emit them. Testing the aggregate would fail while the
    // product is safe, and — worse — a test that passed against the aggregate would say nothing
    // about what actually crosses the wire.
    const res = await publicQuoteGET(new Request("https://app.trymallet.com/x") as never, {
      params: Promise.resolve({ token: sent.publicToken! }),
    });
    expect(res.status).toBe(200);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain("203.0.113.9");
    expect(body).not.toContain("signerIp");
    expect(body).not.toContain("signerUserAgent");
    expect(body).not.toContain("signedSnapshot");
    // Sanity: this really is the quote, so the absences above mean something.
    expect(body).toContain("Leak repair");
  });

  it("GBB public accept without a chosenTier is refused and the quote stays sent", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "GBB No-Tier Customer" });
    const drafted = await draftGbb(caller, lead.id);
    const sent = await caller.v1.quoting.send({ estimateId: drafted.id });

    const result = await acceptPublicQuote(sent.publicToken!);
    expect(result).toEqual({ kind: "invalid_tier", reason: "required" });

    const after = await caller.v1.quoting.get({ estimateId: drafted.id });
    expect(after.status).toBe("sent");
    expect(after.acceptedTier).toBeNull();
  });

  it("single-quote public accept with a chosenTier is refused; accept without one still works", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Single No-Tier Customer" });
    const drafted = await caller.v1.quoting.draft({
      leadId: lead.id,
      title: "Plain quote",
      lines: [{ description: "Work", quantity: 1, rateCents: 30_000 }],
    });
    const sent = await caller.v1.quoting.send({ estimateId: drafted.id });

    const refused = await acceptPublicQuote(sent.publicToken!, undefined, "good");
    expect(refused).toEqual({ kind: "invalid_tier", reason: "not_applicable" });
    expect((await caller.v1.quoting.get({ estimateId: drafted.id })).status).toBe("sent");

    const accepted = await acceptPublicQuote(sent.publicToken!);
    expect(accepted.kind).toBe("ok");
    if (accepted.kind !== "ok") throw new Error("expected ok");
    expect(accepted.estimate.props.acceptedTier).toBeNull();
  });

  it("office accept on a GBB estimate defaults to the recommended tier", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "GBB Office Accept Customer" });
    const drafted = await draftGbb(caller, lead.id);
    await caller.v1.quoting.send({ estimateId: drafted.id });

    const accepted = await caller.v1.quoting.accept({ estimateId: drafted.id });
    expect(accepted.status).toBe("accepted");
    expect(accepted.acceptedTier).toBe("better");
    // Resolved to the recommended tier's lines. The un-toggled add-on survives as an
    // optional line (mirrors single-format office accept) and stays out of the totals.
    expect(accepted.lines).toHaveLength(2);
    expect(accepted.lines.every((l) => l.tier === null)).toBe(true);
    expect(accepted.lines.filter((l) => l.isOptional)).toHaveLength(1);
    expect(accepted.total.cents).toBe(38_500);
  });

  it("office accept can pick a NON-recommended tier explicitly", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "GBB Office Best Customer" });
    const drafted = await draftGbb(caller, lead.id);
    await caller.v1.quoting.send({ estimateId: drafted.id });

    const accepted = await caller.v1.quoting.accept({ estimateId: drafted.id, chosenTier: "best" });
    expect(accepted.acceptedTier).toBe("best");
    expect(accepted.total.cents).toBe(99_000); // 90_000 + 10% tax
  });

  // -------------------------------------------------------------------------
  // Public accept/decline advance the LEAD stage inline (no outbox handler
  // exists for estimate.accepted/.declined — the move must happen in the tx).
  // -------------------------------------------------------------------------

  const leadStage = async (leadId: string): Promise<string | undefined> => {
    const [row] = await admin<{ stage: string }[]>`
      select stage from leads where id = ${leadId}`;
    return row?.stage;
  };

  it("public accept moves the lead to won (same tx as the accept)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Stage Won Customer" });
    const drafted = await caller.v1.quoting.draft({
      leadId: lead.id,
      title: "Stage move test",
      lines: [{ description: "Work", quantity: 1, rateCents: 20_000 }],
    });
    const sent = await caller.v1.quoting.send({ estimateId: drafted.id });
    expect(await leadStage(lead.id)).not.toBe("won");

    const result = await acceptPublicQuote(sent.publicToken!);
    expect(result.kind).toBe("ok");
    expect(await leadStage(lead.id)).toBe("won");
  });

  it("re-accept on an already-won lead stays the idempotent ok path (no error)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Stage Rewon Customer" });
    const drafted = await caller.v1.quoting.draft({
      leadId: lead.id,
      lines: [{ description: "Work", quantity: 1, rateCents: 10_000 }],
    });
    const sent = await caller.v1.quoting.send({ estimateId: drafted.id });

    const first = await acceptPublicQuote(sent.publicToken!);
    expect(first.kind).toBe("ok");
    const second = await acceptPublicQuote(sent.publicToken!);
    expect(second.kind).toBe("ok");
    expect(await leadStage(lead.id)).toBe("won");
  });

  it("public decline moves the lead to lost (mirrors the office client-side move)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Stage Lost Customer" });
    const drafted = await caller.v1.quoting.draft({
      leadId: lead.id,
      lines: [{ description: "Work", quantity: 1, rateCents: 10_000 }],
    });
    const sent = await caller.v1.quoting.send({ estimateId: drafted.id });

    const declined = await declinePublicQuote(sent.publicToken!, "too expensive");
    expect(declined?.props.status).toBe("declined");
    expect(await leadStage(lead.id)).toBe("lost");

    // Idempotent re-decline: terminal estimate returns current state, stage stays lost.
    const again = await declinePublicQuote(sent.publicToken!, "second reason");
    expect(again?.props.status).toBe("declined");
    expect(await leadStage(lead.id)).toBe("lost");
  });

  it("declining a SECOND quote does not flip a WON lead back to lost (won is sticky)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Sticky Won Customer" });
    const draftA = await caller.v1.quoting.draft({
      leadId: lead.id,
      title: "Option A",
      lines: [{ description: "Work A", quantity: 1, rateCents: 10_000 }],
    });
    const sentA = await caller.v1.quoting.send({ estimateId: draftA.id });
    const draftB = await caller.v1.quoting.draft({
      leadId: lead.id,
      title: "Option B",
      lines: [{ description: "Work B", quantity: 1, rateCents: 20_000 }],
    });
    const sentB = await caller.v1.quoting.send({ estimateId: draftB.id });

    // Customer accepts quote A → lead won (job created in the accept savepoint).
    const accepted = await acceptPublicQuote(sentA.publicToken!);
    expect(accepted.kind).toBe("ok");
    expect(await leadStage(lead.id)).toBe("won");

    // Anyone holding quote B's token declines it: B records the decline, but
    // the WON lead (with its live job) must NOT flip to lost.
    const declined = await declinePublicQuote(sentB.publicToken!, "went with the other option");
    expect(declined?.props.status).toBe("declined");
    expect(await leadStage(lead.id)).toBe("won");
  });

  it("accept after a decline still wins the lead (lost → won stays unconditional)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Lost Then Won Customer" });
    const draftA = await caller.v1.quoting.draft({
      leadId: lead.id,
      title: "Option A",
      lines: [{ description: "Work A", quantity: 1, rateCents: 10_000 }],
    });
    const sentA = await caller.v1.quoting.send({ estimateId: draftA.id });
    const draftB = await caller.v1.quoting.draft({
      leadId: lead.id,
      title: "Option B",
      lines: [{ description: "Work B", quantity: 1, rateCents: 20_000 }],
    });
    const sentB = await caller.v1.quoting.send({ estimateId: draftB.id });

    const declined = await declinePublicQuote(sentB.publicToken!, "too expensive");
    expect(declined?.props.status).toBe("declined");
    expect(await leadStage(lead.id)).toBe("lost");

    const accepted = await acceptPublicQuote(sentA.publicToken!);
    expect(accepted.kind).toBe("ok");
    expect(await leadStage(lead.id)).toBe("won");
  });

  it("office accept leaves the lead stage to the client (unchanged server-side)", async () => {
    // The office flow moves the lead via moveLeadStage in cust-quote-modal; the
    // server-side inline move is scoped to the PUBLIC token paths. Pin that.
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Stage Office Customer" });
    const before = await leadStage(lead.id);
    const drafted = await caller.v1.quoting.draft({
      leadId: lead.id,
      lines: [{ description: "Work", quantity: 1, rateCents: 10_000 }],
    });
    await caller.v1.quoting.send({ estimateId: drafted.id });
    const accepted = await caller.v1.quoting.accept({ estimateId: drafted.id });
    expect(accepted.status).toBe("accepted");
    expect(await leadStage(lead.id)).toBe(before);
  });

  it("draft boundary rejects inconsistent tier payloads", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    // Tiered lines without recommendedTier.
    await expect(
      caller.v1.quoting.draft({
        leadId: leadAId,
        lines: [{ description: "x", quantity: 1, rateCents: 1_000, tier: "good" }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // recommendedTier with an untagged line.
    await expect(
      caller.v1.quoting.draft({
        leadId: leadAId,
        recommendedTier: "good",
        lines: [
          { description: "x", quantity: 1, rateCents: 1_000, tier: "good" },
          { description: "y", quantity: 1, rateCents: 2_000 },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // ── deposits are COLLECTED, not assumed ────────────────────────────────────
  //
  // Task 4 removed the fake depPaid stamping at accept, so the only thing that can record a
  // deposit is a real payment landing through recordEstimateDeposit — the recorder BOTH Stripe
  // entry points (webhook + /pay/success reconcile) call. These run it against the live DB, under
  // real RLS, against the real estimate_deposits ledger and its UNIQUE (org_id, payment_ref).

  /** dep_paid_cents as the DB actually holds it (admin connection — bypasses RLS deliberately). */
  const depPaidOf = async (estimateId: string): Promise<number> => {
    const [row] = await admin<{ dep_paid_cents: number }[]>`
      select dep_paid_cents from estimates where id = ${estimateId}`;
    return row!.dep_paid_cents;
  };

  /** The ledger rows behind that number. */
  const ledgerOf = async (
    estimateId: string,
  ): Promise<{ payment_ref: string; amount_cents: number }[]> =>
    admin<{ payment_ref: string; amount_cents: number }[]>`
      select payment_ref, amount_cents from estimate_deposits
       where estimate_id = ${estimateId} order by amount_cents`;

  const acceptedQuote = async (title: string, depBps: number, rateCents: number) => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const drafted = await caller.v1.quoting.draft({
      leadId: leadAId,
      title,
      depBps,
      lines: [{ description: "Labor", quantity: 1, rateCents }],
    });
    await caller.v1.quoting.send({ estimateId: drafted.id });
    const accepted = await caller.v1.quoting.accept({ estimateId: drafted.id });
    return { id: drafted.id, accepted };
  };

  it("records a deposit, and the SAME payment delivered twice writes exactly one ledger row", async () => {
    const { id, accepted } = await acceptedQuote("Deposit — happy path", 3_000, 100_000);
    expect(accepted.status).toBe("accepted");
    expect(accepted.depositDue.cents).toBe(30_000);
    expect(await depPaidOf(id)).toBe(0); // accepted, not paid

    // The webhook lands.
    expect(await recordEstimateDeposit(orgAId, id, 30_000, "pi_int_same")).toBe(true);
    expect(await depPaidOf(id)).toBe(30_000);

    // The success-page reconcile lands for the SAME payment_intent. It reports success — the money
    // IS on the quote — while the UNIQUE (org_id, payment_ref) index makes the write a no-op.
    expect(await recordEstimateDeposit(orgAId, id, 30_000, "pi_int_same")).toBe(true);
    expect(await depPaidOf(id)).toBe(30_000); // not 60_000
    expect(await ledgerOf(id)).toHaveLength(1);
  });

  it("TWO DIFFERENT payments on one quote both persist, and dep_paid_cents is their SUM", async () => {
    // The case a bare mutable integer could not express. Reachable in production: resignOnSite
    // re-prices an accepted quote, so a second checkout session can exist alongside the first and
    // both can settle. `SET` lost one of them; the ledger keeps both.
    const { id } = await acceptedQuote("Deposit — two payments", 3_000, 100_000);

    expect(await recordEstimateDeposit(orgAId, id, 30_000, "pi_int_A")).toBe(true);
    expect(await recordEstimateDeposit(orgAId, id, 60_000, "pi_int_B")).toBe(true);

    expect(await depPaidOf(id)).toBe(90_000); // A + B, derived by SUM — not the larger, not one
    expect(await ledgerOf(id)).toEqual([
      { payment_ref: "pi_int_A", amount_cents: 30_000 },
      { payment_ref: "pi_int_B", amount_cents: 60_000 },
    ]);
  });

  it("a SMALLER later payment is kept too — arrival order decides nothing", async () => {
    const { id } = await acceptedQuote("Deposit — smaller second", 3_000, 100_000);

    expect(await recordEstimateDeposit(orgAId, id, 60_000, "pi_int_big")).toBe(true);
    // Under the old `dep_paid_cents < amount` guard this wrote nothing AND reported success.
    expect(await recordEstimateDeposit(orgAId, id, 30_000, "pi_int_small")).toBe(true);

    expect(await depPaidOf(id)).toBe(90_000);
    expect(await ledgerOf(id)).toHaveLength(2);
  });

  it("CONCURRENT payments: overlapping transactions cannot leave the cached total behind", async () => {
    // The regression for the READ COMMITTED anomaly. Two recorders overlap: T1 appends A and holds
    // its transaction open; T2 appends B while T1's estimate row lock is still held.
    //
    // Without `FOR UPDATE` on the estimate scan, T2 inserted its ledger row FIRST and only then
    // blocked, inside its `UPDATE … SET dep_paid_cents = (SELECT sum(…))` — and that subquery had
    // already been planned against T2's pre-block snapshot, which cannot see A. The ledger ended
    // up holding both payments while dep_paid_cents held one, permanently: every consumer reads
    // the cache and nothing re-derives, so the invoice credited less than the customer paid.
    //
    // With FOR UPDATE, T2 blocks BEFORE inserting, so its later statements take fresh snapshots.
    // Sequential tests structurally cannot catch this — the transactions must genuinely overlap.
    const { id } = await acceptedQuote("Deposit — concurrent", 3_000, 100_000);

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const append = (tx: Parameters<Parameters<typeof withTenant>[1]>[0], ref: string, cents: number) =>
      new DrizzleEstimateDepositLedger(tx, asOrgId(orgAId)).append({
        estimateId: asEstimateId(id),
        paymentRef: ref,
        amountCents: cents,
        receivedAt: new Date(),
      });

    // Warm TWO pool connections first. Opening a cold TLS connection to the DB costs several
    // hundred ms, and if T2 spends the hold window connecting instead of blocking, the two
    // transactions never overlap and the test proves nothing.
    await Promise.all([
      withTenant(asOrgId(orgAId), async (tx) => tx.execute(sqlRaw`select 1`)),
      withTenant(asOrgId(orgAId), async (tx) => tx.execute(sqlRaw`select 1`)),
    ]);

    let releaseT1 = (): void => undefined;
    const t1Held = new Promise<void>((resolve) => {
      releaseT1 = resolve;
    });

    const t1 = withTenant(asOrgId(orgAId), async (tx) => {
      const result = await append(tx, "pi_concurrent_A", 30_000);
      await t1Held; // hold the estimate row lock open while T2 tries to record
      return result;
    });

    await sleep(1_000); // T1 has taken its lock

    const t2 = withTenant(asOrgId(orgAId), async (tx) => append(tx, "pi_concurrent_B", 60_000));

    await sleep(3_000); // T2 is now blocked inside append, waiting on T1
    releaseT1();

    const [a, b] = await Promise.all([t1, t2]);
    expect(a.kind).toBe("appended");
    expect(b.kind).toBe("appended");

    // Both payments are on the ledger AND the cached total is their sum — the two agree.
    expect(await ledgerOf(id)).toHaveLength(2);
    expect(await depPaidOf(id)).toBe(90_000);
    // The winner's own return value reports the full total too, not just its own payment.
    expect(b.kind === "appended" && b.depositPaidCents).toBe(90_000);
  }, 30_000);

  it("refuses a payment_ref already recorded against a DIFFERENT quote in the same org", async () => {
    // The org-wide unique index means such a ref conflicts here too. Answering "duplicate" would
    // report THIS quote's total (0) as though the payment had landed on it; the truth is that it
    // cannot be recorded here at all.
    const first = await acceptedQuote("Deposit — ref owner", 3_000, 100_000);
    const second = await acceptedQuote("Deposit — ref thief", 3_000, 100_000);

    expect(await recordEstimateDeposit(orgAId, first.id, 30_000, "pi_shared_ref")).toBe(true);
    expect(await recordEstimateDeposit(orgAId, second.id, 30_000, "pi_shared_ref")).toBe(false);

    expect(await depPaidOf(first.id)).toBe(30_000);
    expect(await depPaidOf(second.id)).toBe(0);
    expect(await ledgerOf(second.id)).toHaveLength(0);
  });

  it("refuses a deposit against a quote in another org, and against an unapproved quote", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const drafted = await caller.v1.quoting.draft({
      leadId: leadAId,
      title: "Deposit — refusals",
      depBps: 5_000,
      lines: [{ description: "Labor", quantity: 1, rateCents: 100_000 }],
    });

    // Not approved yet — a deposit on an unapproved quote is not a deposit.
    expect(await recordEstimateDeposit(orgAId, drafted.id, 50_000, "pi_int_unapproved")).toBe(false);
    expect(await ledgerOf(drafted.id)).toHaveLength(0);

    await caller.v1.quoting.send({ estimateId: drafted.id });
    await caller.v1.quoting.accept({ estimateId: drafted.id });

    // Cross-tenant: org B naming org A's estimate id. RLS scopes both the read and the ledger
    // write, so it resolves to nothing — indistinguishable from a missing estimate.
    expect(await recordEstimateDeposit(orgBId, drafted.id, 50_000, "pi_int_crosstenant")).toBe(false);
    expect(await depPaidOf(drafted.id)).toBe(0);
    expect(await ledgerOf(drafted.id)).toHaveLength(0);

    // Its own org still can.
    expect(await recordEstimateDeposit(orgAId, drafted.id, 50_000, "pi_int_ownorg")).toBe(true);
    expect(await depPaidOf(drafted.id)).toBe(50_000);
  });

  it("a save() on an accepted quote cannot wipe a collected deposit", async () => {
    // save() upserts the whole aggregate, and setFollowUp / clearChangeRequest / resignOnSite all
    // call it on accepted estimates from an in-memory copy loaded before the deposit landed.
    // dep_paid_cents is therefore INSERT-ONLY in that upsert — collected money is written only by
    // the ledger path. Before that, a follow-up toggle silently zeroed a real deposit.
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const { id } = await acceptedQuote("Deposit — save() clobber", 3_000, 100_000);
    expect(await recordEstimateDeposit(orgAId, id, 30_000, "pi_int_clobber")).toBe(true);
    expect(await depPaidOf(id)).toBe(30_000);

    // A perfectly ordinary office action that goes through save() with no status guard.
    await caller.v1.quoting.setFollowUp({ estimateId: id, on: true, stage: 1 });

    expect(await depPaidOf(id)).toBe(30_000); // still there
    expect(await ledgerOf(id)).toHaveLength(1);
    // And the office can SEE it — the DTO carries what was collected, not just the ask.
    const fetched = await caller.v1.quoting.get({ estimateId: id });
    expect(fetched.depositPaid.cents).toBe(30_000);
    expect(fetched.depositDue.cents).toBe(30_000);
  });

  it("END TO END: accepted quote → deposit collected → job billed → invoice nets the deposit out", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Deposit Chain Customer" });

    // 1. Quote it: $1,000 of work, 30% deposit asked for.
    const drafted = await caller.v1.quoting.draft({
      leadId: lead.id,
      title: "Water heater swap",
      depBps: 3_000,
      lines: [{ description: "Install", quantity: 1, rateCents: 100_000 }],
    });
    await caller.v1.quoting.send({ estimateId: drafted.id });
    const accepted = await caller.v1.quoting.accept({ estimateId: drafted.id });
    expect(accepted.total.cents).toBe(100_000);
    expect(accepted.depositDue.cents).toBe(30_000);
    expect(accepted.depositPaid.cents).toBe(0); // agreed, not paid

    // 2. The deposit is COLLECTED (this is what Task 8 added; before it, nothing did this).
    expect(await recordEstimateDeposit(orgAId, drafted.id, 30_000, "pi_int_chain")).toBe(true);

    // 3. The job accept created runs and completes.
    const jobId = accepted.job!.id;
    await caller.v1.jobs.start({ jobId });
    const done = await caller.v1.jobs.complete({ jobId });
    expect(done.status).toBe("complete");

    // 4. Billing the job credits the deposit through invoicing's EstimateDepositReader (Task 2).
    const invoice = await caller.v1.invoicing.createFromJob({ jobId });
    expect(invoice.total.cents).toBe(100_000);
    expect(invoice.depositPaid.cents).toBe(30_000);
    // The bill asks for what is actually still owed — total minus the deposit already in hand.
    expect(invoice.total.cents - invoice.depositPaid.cents - invoice.amountPaid.cents).toBe(70_000);
  });

});
