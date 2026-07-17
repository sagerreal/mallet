// Integration tests for v1.fieldCopilot.run — the tech-gated copilot endpoint.
//
// Patterns cloned from field-router.int.test.ts (live RLS + admin seeding) and
// ai-router.int.test.ts (ScriptedLlm fake — NEVER hits Anthropic).
//
// Cases:
//   1. tech ON job → 200-shape response
//   2. tech NOT on job → FORBIDDEN
//   3. office caller → allowed (no assignment check)
//   4. nonexistent job → NOT_FOUND
//   5. fake-LLM tool-use round trip proves get_my_job is REDACTED for !seesPrice tech

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { Principal, Role } from "@mallet/identity";
import type { LlmClient, LlmRequest, AssistantTurn, AssistantBlock } from "@mallet/ai";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Scripted fake LLM (no real Anthropic call)
// ---------------------------------------------------------------------------

const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 };
const mkTurn = (stopReason: AssistantTurn["stopReason"], blocks: AssistantBlock[]): AssistantTurn => ({ stopReason, blocks, usage });
const callTool = (id: string, name: string, input: unknown): AssistantTurn =>
  mkTurn("tool_use", [{ type: "tool_use", id, name, input }]);
const textTurn = (t: string): AssistantTurn => mkTurn("end_turn", [{ type: "text", text: t }]);

class ScriptedLlm implements LlmClient {
  public readonly requests: LlmRequest[] = [];
  constructor(private readonly turns: AssistantTurn[]) {}
  async next(request: LlmRequest): Promise<AssistantTurn> {
    this.requests.push(request);
    const t = this.turns.shift();
    if (!t) throw new Error("ScriptedLlm out of turns");
    return t;
  }
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

const ctxFor = (userId: string, orgId: string, role: Role, llm: LlmClient = new ScriptedLlm([textTurn("ok")])): Context => ({
  principal: { userId: asUserId(userId), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: {
    authProvider: { authenticate: async () => { throw new Error("unused"); } },
    bus: new InMemoryEventBus(),
    clock: systemClock,
    ids: uuidGenerator,
    paymentLinkGateway: null,
    photoStorageGateway: null,
    llmClient: llm,
    apiKeyAuthenticator: { authenticate: async () => null },
    tokenVerifier: { verify: async () => null },
    signupStore: { createOrgForUser: async () => { throw new Error("unused"); } },
  },
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

suite("v1.fieldCopilot.run — tech-gated agent endpoint (live RLS)", () => {
  let admin: Sql;
  let orgId = "";
  let techOnJobId = "";
  let techOffJobId = "";
  let ownerUserId = "";
  let leadId = "";
  let jobId = ""; // assigned to techOnJobId

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });

    // Seed org
    const [org] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('FieldCopilot Test ' || gen_random_uuid()) returning id
    `;
    orgId = org!.id;

    // Seed users
    const [tOn] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, 'techon@copilot.test', 'tech') returning id
    `;
    techOnJobId = tOn!.id;

    const [tOff] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, 'techoff@copilot.test', 'tech') returning id
    `;
    techOffJobId = tOff!.id;

    const [ow] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, 'owner@copilot.test', 'owner') returning id
    `;
    ownerUserId = ow!.id;

    // Seed lead + job assigned to techOnJobId
    const [lead] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Copilot Test Customer') returning id
    `;
    leadId = lead!.id;

    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
      values (${orgId}, ${leadId}, 'JOB-CP-01', 'in_progress', 45000, ${techOnJobId}) returning id
    `;
    jobId = j!.id;
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("tech ON job gets 200-shape response", async () => {
    const llm = new ScriptedLlm([textTurn("Check the pressure relief valve.")]);
    const caller = appRouter.createCaller(ctxFor(techOnJobId, orgId, "tech", llm));

    const res = await caller.v1.fieldCopilot.run({ jobId, message: "what should I check?" });

    expect(res.status).toBe("completed");
    expect(typeof res.text).toBe("string");
    expect(res.text.length).toBeGreaterThan(0);
    expect(Array.isArray(res.transcript)).toBe(true);
    expect(res.transcript.length).toBeGreaterThanOrEqual(2);
  });

  it("tech NOT on job gets FORBIDDEN", async () => {
    const llm = new ScriptedLlm([]);
    const caller = appRouter.createCaller(ctxFor(techOffJobId, orgId, "tech", llm));

    await expect(caller.v1.fieldCopilot.run({ jobId, message: "what should I check?" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("office/owner caller is allowed (no assignment check)", async () => {
    const llm = new ScriptedLlm([textTurn("You're all set.")]);
    const caller = appRouter.createCaller(ctxFor(ownerUserId, orgId, "owner", llm));

    const res = await caller.v1.fieldCopilot.run({ jobId, message: "summarise this job" });

    expect(res.status).toBe("completed");
    expect(typeof res.text).toBe("string");
  });

  it("nonexistent job returns NOT_FOUND", async () => {
    const llm = new ScriptedLlm([]);
    const caller = appRouter.createCaller(ctxFor(techOnJobId, orgId, "tech", llm));
    const fakeJobId = randomUUID();

    await expect(caller.v1.fieldCopilot.run({ jobId: fakeJobId, message: "hello" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // Fake-LLM tool-use round trip: get_my_job is REDACTED for !seesPrice tech.
  // Proves: no total/rate/cost in the tool-result JSON when techSeesPrice is off.
  describe("redaction proof via tool-use round trip", () => {
    let redactTechId = "";
    let pricedJobId = "";

    beforeAll(async () => {
      // Turn techSeesPrice off for the org
      await admin`
        insert into org_settings (org_id, tech_sees_price, booking)
        values (${orgId}, false, '{"services":[],"notServices":"","serviceFee":0,"feeCredited":false}'::jsonb)
        on conflict (org_id) do update set tech_sees_price = false
      `;

      const [rt] = await admin<{ id: string }[]>`
        insert into users (org_id, auth_user_id, email, role)
        values (${orgId}, ${randomUUID()}, 'redacttech@copilot.test', 'tech') returning id
      `;
      redactTechId = rt!.id;

      const [j] = await admin<{ id: string }[]>`
        insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
        values (${orgId}, ${leadId}, 'JOB-CP-REDACT', 'in_progress', 45000, ${redactTechId}) returning id
      `;
      pricedJobId = j!.id;

      await admin`
        insert into job_lines (org_id, job_id, description, quantity, rate_cents, cost_cents)
        values (${orgId}, ${pricedJobId}, 'Tank swap', 1, 38000, 22000)
      `;
    });

    afterAll(async () => {
      if (pricedJobId) await admin`delete from jobs where id = ${pricedJobId}`;
      if (redactTechId) await admin`delete from users where id = ${redactTechId}`;
      // Reset techSeesPrice to default (true) so other tests are not affected
      await admin`update org_settings set tech_sees_price = true where org_id = ${orgId}`;
    });

    it("get_my_job tool result has NO total/rate/cost for !seesPrice tech", async () => {
      // Turn 1: model calls get_my_job. Turn 2: model gives text.
      const llm = new ScriptedLlm([
        callTool("r1", "get_my_job", {}),
        textTurn("Here is the redacted summary."),
      ]);

      const caller = appRouter.createCaller(ctxFor(redactTechId, orgId, "tech", llm));
      const res = await caller.v1.fieldCopilot.run({ jobId: pricedJobId, message: "what's on my job?" });

      expect(res.status).toBe("completed");
      // The second LLM request carries the tool_results — parse and assert redaction.
      expect(llm.requests).toHaveLength(2);
      const toolResultMsg = llm.requests[1]!.messages.find(
        (m) => m.role === "user" && m.kind === "tool_results",
      );
      expect(toolResultMsg).toBeDefined();
      if (toolResultMsg?.kind === "tool_results") {
        const content = toolResultMsg.results[0]!.content;
        // The content is the tool summary JSON
        const parsed = JSON.parse(content) as Record<string, unknown>;
        // total must not be present (always stripped by buildRedactedJobContext)
        expect("total" in parsed, "total must not appear in get_my_job output").toBe(false);
        // rate must be null when seesPrice=false
        const lines = (parsed.lines ?? []) as Array<Record<string, unknown>>;
        for (const line of lines) {
          expect(line.rate, "rate must be null when !seesPrice").toBeNull();
          expect(line.cost, "cost must always be null (stripped by redactMoneyForTech)").toBeNull();
        }
      }
    });
  });
});
