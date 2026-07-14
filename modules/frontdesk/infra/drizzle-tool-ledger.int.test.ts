import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { asOrgId } from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { DrizzleToolInvocationLedger } from "./drizzle-tool-ledger";

// Live RLS integration: the idempotency ledger through the real DrizzleToolInvocationLedger
// inside withTenant against the real Supabase DB. Proves save+find round-trip, that a replayed
// tool_call_id returns the FIRST stored result (never re-executes / overwrites), and cross-org
// isolation under RLS.
// Skipped when DB credentials are absent.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

suite("DrizzleToolInvocationLedger against live Supabase RLS", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, {
      max: 1,
      ssl: "require",
      prepare: false,
    });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('Ledger A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('Ledger B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
  });

  afterAll(async () => {
    if (orgAId) {
      // FK to orgs has no ON DELETE CASCADE — clear ledger children first.
      await admin`delete from frontdesk_tool_invocations where org_id in (${orgAId}, ${orgBId})`;
      await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("save then find round-trips the stored result", async () => {
    const orgA = asOrgId(orgAId);
    const vapiCallId = `vc-${crypto.randomUUID()}`;
    const toolCallId = `tc-${crypto.randomUUID()}`;

    const found = await withTenant(orgA, async (tx) => {
      const ledger = new DrizzleToolInvocationLedger(tx, orgA);
      await ledger.save({
        orgId: orgA,
        vapiCallId,
        toolCallId,
        tool: "take_message",
        result: { speak: "Got it — passed to the office." },
      });
      return ledger.find(vapiCallId, toolCallId);
    });

    expect(found).not.toBeNull();
    expect(found!.result).toEqual({ speak: "Got it — passed to the office." });
  });

  it("find returns null for an unknown toolCallId", async () => {
    const orgA = asOrgId(orgAId);
    const found = await withTenant(orgA, async (tx) => {
      const ledger = new DrizzleToolInvocationLedger(tx, orgA);
      return ledger.find(`vc-${crypto.randomUUID()}`, `tc-${crypto.randomUUID()}`);
    });
    expect(found).toBeNull();
  });

  it("is idempotent on replay: second save with same toolCallId keeps the first result", async () => {
    const orgA = asOrgId(orgAId);
    const vapiCallId = `vc-${crypto.randomUUID()}`;
    const toolCallId = `tc-${crypto.randomUUID()}`;

    const found = await withTenant(orgA, async (tx) => {
      const ledger = new DrizzleToolInvocationLedger(tx, orgA);
      await ledger.save({
        orgId: orgA,
        vapiCallId,
        toolCallId,
        tool: "book_visit",
        result: { speak: "You're booked tomorrow morning.", data: { jobId: "first" } },
      });
      // Vapi retries the same tool call — the result must NOT change (no double-book).
      await ledger.save({
        orgId: orgA,
        vapiCallId,
        toolCallId,
        tool: "book_visit",
        result: { speak: "SECOND — should be ignored.", data: { jobId: "second" } },
      });
      return ledger.find(vapiCallId, toolCallId);
    });

    expect(found).not.toBeNull();
    expect(found!.result).toEqual({
      speak: "You're booked tomorrow morning.",
      data: { jobId: "first" },
    });
  });

  it("cannot read another org's ledger row (cross-org isolation under RLS)", async () => {
    const foreignCallId = `vc-${crypto.randomUUID()}`;
    const foreignToolCallId = `tc-${crypto.randomUUID()}`;
    await admin`
      insert into frontdesk_tool_invocations (org_id, vapi_call_id, tool_call_id, tool, result)
      values (${orgBId}, ${foreignCallId}, ${foreignToolCallId}, 'book_visit',
              ${admin.json({ speak: "foreign" })})`;

    const orgA = asOrgId(orgAId);
    const found = await withTenant(orgA, async (tx) => {
      const ledger = new DrizzleToolInvocationLedger(tx, orgA);
      return ledger.find(foreignCallId, foreignToolCallId);
    });
    expect(found).toBeNull();
  });

  it("cannot save a ledger row stamped with another org's id (RLS WITH CHECK)", async () => {
    const orgA = asOrgId(orgAId);
    let rejected = false;
    try {
      await withTenant(orgA, async (tx) => {
        const ledger = new DrizzleToolInvocationLedger(tx, asOrgId(orgBId));
        await ledger.save({
          orgId: asOrgId(orgBId),
          vapiCallId: `vc-${crypto.randomUUID()}`,
          toolCallId: `tc-${crypto.randomUUID()}`,
          tool: "take_message",
          result: { speak: "mallory" },
        });
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});
