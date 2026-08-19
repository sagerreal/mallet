import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { AuthProvider, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

/**
 * The shop-defined pipeline, against the LIVE database and its real RLS.
 *
 * The board is manual by design, so what these tests defend is not a derivation — it is the
 * boundaries: a seed that cannot double, a removal that visibly returns customers to the
 * unstaged column instead of vanishing them, and a stage id from another org that reads as
 * not-found rather than as a link.
 */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = { authenticate: async () => { throw new Error("unused"); } };
const ctxFor = (orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role },
  unmapped: null, tx: null,
  deps: {
    authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator,
    paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null, llmClient: null,
    apiKeyAuthenticator: { authenticate: async () => null },
    tokenVerifier: { verify: async () => null },
    signupStore: { createOrgForUser: async () => { throw new Error("unused"); } },
  },
});

suite("customer pipeline (live RLS)", () => {
  let admin: Sql;
  let orgA = "";
  let orgB = "";

  const addLead = async (org: string, name: string) => {
    const [l] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${org}, ${name}) returning id`;
    return l!.id;
  };

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('PipeA ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('PipeB ' || gen_random_uuid()) returning id`;
    orgA = a!.id;
    orgB = b!.id;
  });

  afterAll(async () => {
    if (orgA) await admin`delete from orgs where id = ${orgA}`;
    if (orgB) await admin`delete from orgs where id = ${orgB}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("seeds a template once — the second call returns the first pipeline untouched", async () => {
    const caller = appRouter.createCaller(ctxFor(orgA, "owner"));
    const first = await caller.v1.customers.pipeline.seed({ template: "sales" });
    expect(first.map((s) => s.name)).toEqual(
      ["New lead", "Contacted", "Walkthrough booked", "Quote sent", "Follow-up", "Won"]);
    const again = await caller.v1.customers.pipeline.seed({ template: "insurance" });
    expect(again.map((s) => s.id)).toEqual(first.map((s) => s.id));
  });

  it("places a lead, counts it on the board, and the list filter finds it", async () => {
    const caller = appRouter.createCaller(ctxFor(orgA, "owner"));
    const stages = (await caller.v1.customers.pipeline.board()).stages;
    const followUp = stages.find((s) => s.name === "Follow-up")!;
    const leadId = await addLead(orgA, "Marta Feldkamp");

    await caller.v1.customers.pipeline.setLeadStage({ leadId, stageId: followUp.id });

    const board = await caller.v1.customers.pipeline.board();
    expect(board.stages.find((s) => s.id === followUp.id)?.count).toBe(1);
    const page = await caller.v1.customers.list({ pipelineStage: followUp.id, limit: 10 });
    expect(page.items.map((l) => l.id)).toEqual([leadId]);
    expect(page.items[0]?.pipelineStageId).toBe(followUp.id);
  });

  it("removing a stage returns its customers to Unstaged on the board — nobody vanishes", async () => {
    const caller = appRouter.createCaller(ctxFor(orgA, "owner"));
    const before = await caller.v1.customers.pipeline.board();
    const followUp = before.stages.find((s) => s.name === "Follow-up")!;

    await caller.v1.customers.pipeline.removeStage({ id: followUp.id });

    const after = await caller.v1.customers.pipeline.board();
    expect(after.stages.some((s) => s.id === followUp.id)).toBe(false);
    // The lead placed in it above now counts as unstaged; total accounting holds.
    expect(after.unstaged).toBe(before.unstaged + 1);
  });

  it("REFUSES another org's stage id — a cross-tenant placement reads as not-found", async () => {
    const callerB = appRouter.createCaller(ctxFor(orgB, "owner"));
    await callerB.v1.customers.pipeline.seed({ template: "blank" });
    const stageB = (await callerB.v1.customers.pipeline.board()).stages[0]!;

    const callerA = appRouter.createCaller(ctxFor(orgA, "owner"));
    const leadA = await addLead(orgA, "Cross Tenant Probe");
    await expect(
      callerA.v1.customers.pipeline.setLeadStage({ leadId: leadA, stageId: stageB.id }),
    ).rejects.toThrow();
    // And the DB never linked them.
    const [row] = await admin<{ pipeline_stage_id: string | null }[]>`
      select pipeline_stage_id from leads where id = ${leadA}`;
    expect(row!.pipeline_stage_id).toBeNull();
  });

  it("org B cannot even SEE org A's stages", async () => {
    const board = await appRouter.createCaller(ctxFor(orgB, "owner")).v1.customers.pipeline.board();
    expect(board.stages.map((s) => s.name)).toEqual(["Stage 1", "Stage 2", "Stage 3"]);
  });

  it("a tech role is refused — the pipeline is an office surface", async () => {
    await expect(
      appRouter.createCaller(ctxFor(orgA, "tech")).v1.customers.pipeline.board(),
    ).rejects.toThrow();
  });
});
