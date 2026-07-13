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
import type { Context } from "@/trpc/init";
import { DrizzleQuotingRuleRepository } from "../infra/drizzle-quoting-rule-repository";

// v1.quoting.rules over the full stack: auth, RBAC, org-scoped tx, use-cases,
// Drizzle repo, live RLS. Owner rules land confirmed; overlapping rules land
// proposed; confirm supersedes; org B sees nothing; a tech is forbidden.
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

suite("quoting rules tRPC router (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let serviceAId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('RulesApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('RulesApi B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    const [svc] = await admin<{ id: string }[]>`
      insert into pricebook_items (org_id, label, unit_price_cents)
      values (${orgAId}, 'Water Heater Swap', 180000) returning id`;
    serviceAId = svc!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("owner create lands confirmed; overlapping create lands proposed; confirm supersedes", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));

    const first = await caller.v1.quoting.rules.create({
      rule: "Include haul-away on every water heater swap",
      jobTag: "water heater",
    });
    expect(first.status).toBe("confirmed");
    expect(first.source).toBe("manual");
    expect(first.timesConfirmed).toBe(1);

    // Overlapping scope → contradiction review, even from the owner.
    const second = await caller.v1.quoting.rules.create({
      rule: "Bill haul-away as a separate line on heater swaps",
      jobTag: "heater swap",
      source: "refine",
    });
    expect(second.status).toBe("proposed");

    let listed = await caller.v1.quoting.rules.list();
    expect(listed.confirmed.map((r) => r.id)).toContain(first.id);
    expect(listed.proposed.map((r) => r.id)).toContain(second.id);

    // Confirm the proposal — the old confirmed rule is superseded out of force.
    const promoted = await caller.v1.quoting.rules.confirm({ ruleId: second.id });
    expect(promoted.status).toBe("confirmed");

    listed = await caller.v1.quoting.rules.list();
    expect(listed.confirmed.map((r) => r.id)).toContain(second.id);
    expect(listed.confirmed.map((r) => r.id)).not.toContain(first.id);
    expect(listed.proposed).toHaveLength(0);
  });

  it("dismiss forgets a confirmed rule", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.quoting.rules.create({
      rule: "Pull a permit on any gas line work",
      jobTag: "gas line",
    });
    expect((await caller.v1.quoting.rules.list()).confirmed.map((r) => r.id)).toContain(created.id);

    await caller.v1.quoting.rules.dismiss({ ruleId: created.id });
    const listed = await caller.v1.quoting.rules.list();
    expect(listed.confirmed.map((r) => r.id)).not.toContain(created.id);
  });

  it("a service-scoped rule matches jobs by the service's name", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "office"));
    const created = await caller.v1.quoting.rules.create({
      rule: "Quote a pan + drain line with this when the unit is in the attic",
      serviceId: serviceAId,
    });
    expect(created.status).toBe("confirmed");

    const matched = await withTenant(asOrgId(orgAId), (tx) =>
      new DrizzleQuotingRuleRepository(tx, asOrgId(orgAId)).findMatching("swap the water heater in the attic"),
    );
    expect(matched.map((m) => m.rule.props.id)).toContain(created.id);
    expect(matched.find((m) => m.rule.props.id === created.id)?.serviceName).toBe("Water Heater Swap");

    const unmatched = await withTenant(asOrgId(orgAId), (tx) =>
      new DrizzleQuotingRuleRepository(tx, asOrgId(orgAId)).findMatching("unclog the kitchen sink"),
    );
    expect(unmatched.map((m) => m.rule.props.id)).not.toContain(created.id);
  });

  it("a rule cannot reference another org's service (composite FK)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgBId, "owner"));
    await expect(
      caller.v1.quoting.rules.create({ rule: "Steal a scope", serviceId: serviceAId }),
    ).rejects.toThrow();
  });

  it("another org sees no rules (RLS)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const listed = await caller.v1.quoting.rules.list();
    expect(listed.confirmed).toHaveLength(0);
    expect(listed.proposed).toHaveLength(0);
  });

  it("org B sees ZERO of org A's rules through findMatching (explicit org filter + RLS)", async () => {
    // Org A has confirmed rules from the earlier tests; the same job text that
    // matches them for org A must return nothing when the repo is built for
    // org B — a leak here would inject A's pricing guidance into B's prompts.
    const matchedForA = await withTenant(asOrgId(orgAId), (tx) =>
      new DrizzleQuotingRuleRepository(tx, asOrgId(orgAId)).findMatching("swap the water heater in the attic"),
    );
    expect(matchedForA.length).toBeGreaterThan(0);

    const matchedForB = await withTenant(asOrgId(orgBId), (tx) =>
      new DrizzleQuotingRuleRepository(tx, asOrgId(orgBId)).findMatching("swap the water heater in the attic"),
    );
    expect(matchedForB).toHaveLength(0);
  });

  it("a tech is forbidden", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(caller.v1.quoting.rules.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.v1.quoting.rules.create({ rule: "nope" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
