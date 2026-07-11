import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { Phone, asOrgId, asLeadId, toPage, isOk } from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { DrizzleLeadRepository } from "./drizzle-lead-repository";

// Live RLS integration: the app (mallet_app, NOBYPASSRLS) goes through the real DrizzleLead
// repository inside withTenant, against the real Supabase DB. Proves idempotency, keyset
// paging, and — most importantly — that one tenant physically cannot read another's rows.
// Skipped when DB credentials are absent (e.g. CI without secrets), where Testcontainers runs.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

suite("DrizzleLeadRepository against live Supabase RLS", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let foreignLeadId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, {
      max: 1,
      ssl: "require",
      prepare: false,
    });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('IntTest A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('IntTest B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    const [lead] = await admin<{ id: string }[]>`
      insert into leads (org_id, name, phone_e164)
      values (${orgBId}, 'Foreign Bob', '+15550000000') returning id`;
    foreignLeadId = lead!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("ensureCustomer is idempotent on phone (one row; second call is not 'created')", async () => {
    const parsed = Phone.parse("555-111-2222");
    expect(isOk(parsed)).toBe(true);
    const phone = isOk(parsed) ? parsed.value : null;
    const orgA = asOrgId(orgAId);

    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleLeadRepository(tx, orgA);
      const first = await repo.ensureCustomer({ name: "Alice", phone, email: null, source: "web", companyId: null, role: null, notes: null });
      const second = await repo.ensureCustomer({
        name: "Alice (again)",
        phone,
        email: null,
        source: "phone",
        companyId: null,
        role: null,
        notes: null,
      });
      const listed = await repo.list(toPage({ limit: 100 }));
      return { first, second, count: listed.items.length };
    });

    expect(result.first.created).toBe(true);
    expect(result.second.created).toBe(false);
    expect(result.first.lead.props.id).toBe(result.second.lead.props.id);
    expect(result.count).toBe(1);
  });

  it("cannot read another org's lead — by id or in a list", async () => {
    const orgA = asOrgId(orgAId);
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleLeadRepository(tx, orgA);
      const byId = await repo.findById(asLeadId(foreignLeadId));
      const all = await repo.list(toPage({ limit: 100 }));
      return { byId, names: all.items.map((l) => l.props.name) };
    });

    expect(result.byId).toBeNull();
    expect(result.names).not.toContain("Foreign Bob");
  });

  it("cannot insert a lead stamped with another org's id (RLS WITH CHECK)", async () => {
    const orgA = asOrgId(orgAId);
    let rejected = false;
    try {
      await withTenant(orgA, async (tx) => {
        // Construct the repo with org B's id while the tx is scoped to org A — the insert's
        // org_id won't match current_org_id(), so the WITH CHECK policy must reject it.
        const repo = new DrizzleLeadRepository(tx, asOrgId(orgBId));
        await repo.ensureCustomer({ name: "Mallory", phone: null, email: null, source: null, companyId: null, role: null, notes: null });
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});
