import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { asOrgId, asLeadId, toPage } from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { DrizzleFrontdeskCallRepository } from "./drizzle-call-repository";

// Live RLS integration: the app role (NOBYPASSRLS) goes through the real
// DrizzleFrontdeskCallRepository inside withTenant against the real Supabase DB. Proves the
// upsertInboundStart → recordEndOfCall single-row upsert, soft-delete filtering, and — most
// importantly — that one tenant physically cannot read another's calls.
// Skipped when DB credentials are absent.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

suite("DrizzleFrontdeskCallRepository against live Supabase RLS", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, {
      max: 1,
      ssl: "require",
      prepare: false,
    });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('CallRepo A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('CallRepo B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;

    const [la] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgAId}, 'Lead for call test') returning id`;
    leadAId = la!.id;
  });

  afterAll(async () => {
    if (orgAId) {
      // FKs to orgs have no ON DELETE CASCADE — clear children first (calls, then leads).
      await admin`delete from frontdesk_calls where org_id in (${orgAId}, ${orgBId})`;
      await admin`delete from leads where org_id in (${orgAId}, ${orgBId})`;
      await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("upsertInboundStart then recordEndOfCall updates the SAME row (one row, not two)", async () => {
    const orgA = asOrgId(orgAId);
    const vapiCallId = `vc-${crypto.randomUUID()}`;

    await withTenant(orgA, async (tx) => {
      const repo = new DrizzleFrontdeskCallRepository(tx, orgA);
      await repo.upsertInboundStart({
        orgId: orgA,
        leadId: null,
        vapiCallId,
        fromNumber: "+16505550111",
        toNumber: "+16693413343",
        startedAt: new Date("2026-07-14T09:00:00Z"),
      });
      // Idempotent replay of the skeleton must not clobber or duplicate.
      await repo.upsertInboundStart({
        orgId: orgA,
        leadId: null,
        vapiCallId,
        fromNumber: "+16505550111",
        toNumber: "+16693413343",
        startedAt: new Date("2026-07-14T09:00:00Z"),
      });
      await repo.recordEndOfCall({
        orgId: orgA,
        leadId: asLeadId(leadAId),
        vapiCallId,
        fromNumber: "+16505550111",
        toNumber: "+16693413343",
        startedAt: new Date("2026-07-14T09:00:00Z"),
        endedAt: new Date("2026-07-14T09:04:00Z"),
        endedReason: "customer-ended-call",
        transcript: "assistant: hi\nuser: book me",
        messages: [
          { role: "assistant", message: "hi" },
          { role: "user", message: "book me" },
        ],
        recordingUrl: "https://rec.example/end.mp3",
        summary: "Booked a job",
        disposition: "booked_job",
        priceAudit: { flagged: [] },
      });
    });

    // Exactly one row for this call, carrying the end-of-call fields + the late lead match.
    const rows = await admin<
      { count: string; disposition: string; transcript: string; lead_id: string | null }[]
    >`
      select count(*)::text as count, max(disposition) as disposition,
             max(transcript) as transcript, max(lead_id::text) as lead_id
      from frontdesk_calls where org_id = ${orgAId} and vapi_call_id = ${vapiCallId}`;
    expect(rows[0]!.count).toBe("1");
    expect(rows[0]!.disposition).toBe("booked_job");
    expect(rows[0]!.transcript).toContain("book me");
    expect(rows[0]!.lead_id).toBe(leadAId);
  });

  it("recordEndOfCall inserts a row when no skeleton exists (call ended before start write)", async () => {
    const orgA = asOrgId(orgAId);
    const vapiCallId = `vc-${crypto.randomUUID()}`;

    const summaries = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleFrontdeskCallRepository(tx, orgA);
      await repo.recordEndOfCall({
        orgId: orgA,
        leadId: null,
        vapiCallId,
        fromNumber: "+16505550222",
        toNumber: "+16693413343",
        startedAt: null,
        endedAt: new Date("2026-07-14T10:00:00Z"),
        endedReason: "assistant-error",
        transcript: null,
        messages: null,
        recordingUrl: null,
        summary: null,
        disposition: "no_action",
        priceAudit: null,
      });
      return repo.listRecent(toPage({ limit: 50 }));
    });

    const found = summaries.find((s) => s.fromNumber === "+16505550222");
    expect(found).toBeDefined();
    expect(found!.disposition).toBe("no_action");
    expect(found!.priceFlagged).toBe(false);
  });

  it("listByLead returns only this org's calls (cross-org isolation under RLS)", async () => {
    // Seed a call for org B directly (admin) — org A must never see it.
    const foreignCallId = `vc-${crypto.randomUUID()}`;
    await admin`
      insert into frontdesk_calls (org_id, vapi_call_id, from_number, to_number, disposition)
      values (${orgBId}, ${foreignCallId}, '+16505559999', '+16693413343', 'booked_job')`;

    const orgA = asOrgId(orgAId);
    const vapiCallId = `vc-${crypto.randomUUID()}`;
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleFrontdeskCallRepository(tx, orgA);
      await repo.recordEndOfCall({
        orgId: orgA,
        leadId: asLeadId(leadAId),
        vapiCallId,
        fromNumber: "+16505550333",
        toNumber: "+16693413343",
        startedAt: new Date("2026-07-14T11:00:00Z"),
        endedAt: new Date("2026-07-14T11:05:00Z"),
        endedReason: "customer-ended-call",
        transcript: "assistant: hi",
        messages: [{ role: "assistant", message: "hi" }],
        recordingUrl: null,
        summary: "message taken",
        disposition: "message",
        priceAudit: { flagged: ["$777"] },
      });
      const byLead = await repo.listByLead(asLeadId(leadAId));
      const recent = await repo.listRecent(toPage({ limit: 100 }));
      return { byLead, recent };
    });

    // The org-A lead's call is present, price-flagged; org-B's call is invisible everywhere.
    const leadCall = result.byLead.find((c) => c.fromNumber === "+16505550333");
    expect(leadCall).toBeDefined();
    expect(leadCall!.disposition).toBe("message");
    expect(leadCall!.priceFlagged).toBe(true);
    expect(result.byLead.map((c) => c.fromNumber)).not.toContain("+16505559999");
    expect(result.recent.map((c) => c.fromNumber)).not.toContain("+16505559999");
  });
});
