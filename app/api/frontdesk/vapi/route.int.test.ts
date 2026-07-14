import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { closeDb } from "@mallet/shared/db/client";

// Capstone integration for the voice webhook: the REAL route (secret verify → org by To-number →
// withTenant → Drizzle repos → live RLS) against the shared Supabase DB. We set VAPI_WEBHOOK_SECRET
// in-process so the route enables, sign requests with the matching x-vapi-secret header, and prove:
// bad secret → 401 before any DB; unset secret → 503; assistant-request returns a playbook-grounded
// { assistant }; a call-less assistant-request still resolves the org; take_message creates a
// lead+task under RLS and is idempotent on toolCallId replay; end-of-call persists transcript +
// disposition and a price-audit violation files a review task; and org B never sees org A's data.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const SECRET = "int-test-vapi-secret-abcdef0123456789";
const WEBHOOK_URL = "http://localhost/api/frontdesk/vapi";

// A unique-per-run number so parallel/repeat runs never collide on the orgs_twilio_number_uidx.
const numFor = (): string => `+1669${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

const post = async (
  body: unknown,
  opts?: { secret?: string | null },
): Promise<Response> => {
  const { POST } = await import("./route");
  const headers: Record<string, string> = { "content-type": "application/json" };
  const secret = opts && "secret" in opts ? opts.secret : SECRET;
  if (secret !== null && secret !== undefined) headers["x-vapi-secret"] = secret;
  const req = new Request(WEBHOOK_URL, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(req);
};

suite("POST /api/frontdesk/vapi (signed, full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  const toA = numFor();
  const toB = numFor();
  const knownFrom = "+14155550188";

  const seedSettings = async (orgId: string, brand: string): Promise<void> => {
    // Booking playbook: $89 service fee (repair credit) + one flat $150 service + one repair.
    const booking = {
      services: [
        { name: "Drain clear", lane: "repair", triggers: "clogged drain" },
        { name: "Faucet swap", lane: "flat", price: 150, triggers: "leaky faucet" },
      ],
      notServices: "septic tanks",
      serviceFee: 89,
      feeCredited: true,
    };
    await admin`
      insert into org_settings (org_id, area_cities, booking, front_desk)
      values (${orgId}, 'Austin', ${admin.json(booking)}, true)`;
    await admin`update orgs set name = ${brand} where id = ${orgId}`;
  };

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    process.env.VAPI_WEBHOOK_SECRET = SECRET;

    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name, twilio_number) values ('VapiRoute A ' || gen_random_uuid(), ${toA}) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name, twilio_number) values ('VapiRoute B ' || gen_random_uuid(), ${toB}) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;

    await seedSettings(orgAId, "Bayline Plumbing");
    await seedSettings(orgBId, "Rival Plumbing");

    // A known caller for org A so assistant-request caller recognition has data.
    await admin`insert into leads (org_id, name, phone_e164) values (${orgAId}, 'Regular Rita', ${knownFrom})`;
  });

  afterAll(async () => {
    if (orgAId) {
      await admin`delete from frontdesk_tool_invocations where org_id in (${orgAId}, ${orgBId})`;
      await admin`delete from frontdesk_calls where org_id in (${orgAId}, ${orgBId})`;
      await admin`delete from tasks where org_id in (${orgAId}, ${orgBId})`;
      await admin`delete from leads where org_id in (${orgAId}, ${orgBId})`;
      await admin`delete from org_settings where org_id in (${orgAId}, ${orgBId})`;
      await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    }
    delete process.env.VAPI_WEBHOOK_SECRET;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  const assistantRequest = (opts: { callId: string | null; to: string; from?: string }) => ({
    message: {
      type: "assistant-request",
      phoneNumber: { number: opts.to },
      ...(opts.callId === null && opts.from === undefined
        ? {}
        : {
            call: {
              ...(opts.callId !== null ? { id: opts.callId } : {}),
              ...(opts.from ? { customer: { number: opts.from } } : {}),
            },
          }),
    },
  });

  it("rejects a bad secret with 401 and never resolves an org", async () => {
    const res = await post(assistantRequest({ callId: "c1", to: toA }), { secret: "wrong-but-same-length-000000000000000" });
    expect(res.status).toBe(401);
  });

  it("returns 503 when the secret is unset (feature dark)", async () => {
    const saved = process.env.VAPI_WEBHOOK_SECRET;
    delete process.env.VAPI_WEBHOOK_SECRET;
    try {
      const res = await post(assistantRequest({ callId: "c1", to: toA }), { secret: null });
      expect(res.status).toBe(503);
    } finally {
      process.env.VAPI_WEBHOOK_SECRET = saved;
    }
  });

  it("returns 400 on a malformed body", async () => {
    const res = await post("not json", {});
    expect(res.status).toBe(400);
  });

  it("assistant-request returns { assistant } grounded in the org playbook (service + fee, no stray $)", async () => {
    const callId = `vc-${randomUUID()}`;
    const res = await post(assistantRequest({ callId, to: toA, from: knownFrom }));
    expect(res.status).toBe(200);
    const dto = (await res.json()) as { assistant: { firstMessage: string; model: { messages: { content: string }[]; tools: unknown[] } } };
    const prompt = dto.assistant.model.messages[0]!.content;

    expect(dto.assistant.firstMessage).toContain("Bayline Plumbing");
    expect(prompt).toContain("Drain clear");
    expect(prompt).toContain("Faucet swap");
    expect(prompt).toContain("$89");
    // The take_message tool spec is injected.
    expect(dto.assistant.model.tools.length).toBeGreaterThan(0);
    // Caller recognition: the known lead's name is baked in.
    expect(prompt).toContain("Regular Rita");
    // No dollar amount other than the sanctioned $89 / $150 appears in the prompt. The token
    // grammar only allows a comma BETWEEN digits (so a trailing "$89," in prose is just "$89").
    const dollars = prompt.match(/\$\s*\d(?:[\d,]*\d)?(?:\.\d+)?/g) ?? [];
    for (const d of dollars) expect(["$89", "$150"]).toContain(d.replace(/\s/g, ""));

    // A skeleton call row was seeded.
    const rows = await admin<{ id: string }[]>`
      select id from frontdesk_calls where org_id = ${orgAId} and vapi_call_id = ${callId}`;
    expect(rows).toHaveLength(1);
  });

  it("a call-less assistant-request still resolves the org and returns an assistant", async () => {
    const res = await post(assistantRequest({ callId: null, to: toA }));
    expect(res.status).toBe(200);
    const dto = (await res.json()) as { assistant: { firstMessage: string } };
    expect(dto.assistant.firstMessage).toContain("Bayline Plumbing");
  });

  it("an unknown To-number returns 200 with a decline assistant (never 5xx)", async () => {
    const res = await post(assistantRequest({ callId: "c1", to: "+19998887777" }));
    expect(res.status).toBe(200);
    const dto = (await res.json()) as { assistant: { firstMessage: string } };
    expect(dto.assistant.firstMessage.length).toBeGreaterThan(0);
  });

  it("tool-calls take_message creates a lead + task under RLS, idempotent on toolCallId replay", async () => {
    const callId = `vc-${randomUUID()}`;
    const toolCallId = `tc-${randomUUID()}`;
    const body = {
      message: {
        type: "tool-calls",
        phoneNumber: { number: toA },
        call: { id: callId, customer: { number: "+14155550199" } },
        toolCallList: [
          {
            id: toolCallId,
            name: "take_message",
            arguments: { caller_name: "Walk In Wanda", phone: "+14155550199", topic: "callback", details: "wants a callback about a slow drain" },
          },
        ],
      },
    };

    const first = await post(body);
    expect(first.status).toBe(200);
    const firstJson = (await first.json()) as { results: { toolCallId: string; result: string }[] };
    expect(firstJson.results[0]!.toolCallId).toBe(toolCallId);

    const leadsAfter = await admin<{ id: string }[]>`
      select id from leads where org_id = ${orgAId} and phone_e164 = '+14155550199'`;
    expect(leadsAfter).toHaveLength(1);
    const tasksAfter = await admin<{ id: string; text: string }[]>`
      select id, text from tasks where org_id = ${orgAId} and text like 'Call from Walk In Wanda%'`;
    expect(tasksAfter).toHaveLength(1);

    // Replay the SAME toolCallId — the ledger returns the stored result, no duplicate task.
    const replay = await post(body);
    expect(replay.status).toBe(200);
    const tasksAfterReplay = await admin<{ id: string }[]>`
      select id from tasks where org_id = ${orgAId} and text like 'Call from Walk In Wanda%'`;
    expect(tasksAfterReplay).toHaveLength(1);
  });

  it("end-of-call-report persists transcript + disposition; a price violation files a review task", async () => {
    const callId = `vc-${randomUUID()}`;
    const toolCallId = `tc-${randomUUID()}`;
    // First run a take_message so the call has a ledger row → disposition 'message'.
    await post({
      message: {
        type: "tool-calls",
        phoneNumber: { number: toA },
        call: { id: callId, customer: { number: knownFrom } },
        toolCallList: [
          { id: toolCallId, name: "take_message", arguments: { caller_name: "Regular Rita", topic: "other", details: "note" } },
        ],
      },
    });

    const res = await post({
      message: {
        type: "end-of-call-report",
        phoneNumber: { number: toA },
        call: { id: callId, customer: { number: knownFrom } },
        endedReason: "customer-ended-call",
        startedAt: "2026-07-14T09:00:00.000Z",
        endedAt: "2026-07-14T09:03:00.000Z",
        artifact: {
          transcript: "assistant: The visit is $89. And the repair might be $300.\nuser: ok",
          messages: [
            { role: "assistant", message: "The visit is $89." },
            { role: "assistant", message: "The repair might be $300." },
            { role: "user", message: "ok" },
          ],
          recordingUrl: "https://rec.example/x.mp3",
        },
      },
    });
    expect(res.status).toBe(200);

    const calls = await admin<{ disposition: string; transcript: string; price_audit: { flagged: string[] } }[]>`
      select disposition, transcript, price_audit from frontdesk_calls where org_id = ${orgAId} and vapi_call_id = ${callId}`;
    expect(calls).toHaveLength(1);
    expect(calls[0]!.disposition).toBe("message");
    expect(calls[0]!.transcript).toContain("$300");
    expect(calls[0]!.price_audit.flagged).toEqual(["$300"]);

    // The unsanctioned "$300" filed a review task.
    const reviewTasks = await admin<{ id: string }[]>`
      select id from tasks where org_id = ${orgAId} and text like 'Review AI call — unapproved price mentioned:%$300%'`;
    expect(reviewTasks.length).toBeGreaterThanOrEqual(1);
  });

  it("cross-org isolation: an org-B number never surfaces org-A's playbook", async () => {
    const res = await post(assistantRequest({ callId: `vc-${randomUUID()}`, to: toB }));
    expect(res.status).toBe(200);
    const dto = (await res.json()) as { assistant: { firstMessage: string; model: { messages: { content: string }[] } } };
    const prompt = dto.assistant.model.messages[0]?.content ?? "";
    expect(dto.assistant.firstMessage).toContain("Rival Plumbing");
    // Org A's known caller must not leak into org B's prompt.
    expect(prompt).not.toContain("Regular Rita");
  });
});
