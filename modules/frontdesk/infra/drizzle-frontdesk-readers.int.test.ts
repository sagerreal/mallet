import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { asOrgId, asLeadId } from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { DrizzleSettingsReader } from "./drizzle-settings-reader";
import { DrizzleLeadSummaryReader } from "./drizzle-lead-summary-reader";

// Live RLS integration for the two A4 readers. Proves (a) the settings reader returns a real
// org's booking playbook via the existing getConfig read path, and (b) the lead-summary reader
// returns a lead's name + one-line open-work in a SINGLE query, org-scoped. Skipped without DB.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

suite("A4 frontdesk readers against live Supabase RLS", () => {
  let admin: Sql;
  let orgId = "";
  let leadWithJobId = "";
  let leadNoJobId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('A4Readers ' || gen_random_uuid()) returning id`;
    orgId = o!.id;

    const [l1] = await admin<{ id: string }[]>`
      insert into leads (org_id, name, phone_e164) values (${orgId}, 'Dana Ruiz', '+14155550100') returning id`;
    leadWithJobId = l1!.id;
    const [l2] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'No Jobs Nancy') returning id`;
    leadNoJobId = l2!.id;

    // One active job (scheduled) + one completed job that must be ignored.
    await admin`
      insert into jobs (org_id, num, lead_id, title, status, scheduled_start)
      values (${orgId}, '142', ${leadWithJobId}, 'drain clear', 'scheduled', '2026-07-16T15:00:00Z')`;
    await admin`
      insert into jobs (org_id, num, lead_id, title, status, scheduled_start)
      values (${orgId}, '099', ${leadWithJobId}, 'old repair', 'complete', '2026-01-01T15:00:00Z')`;
  });

  afterAll(async () => {
    if (orgId) {
      await admin`delete from jobs where org_id = ${orgId}`;
      await admin`delete from org_settings where org_id = ${orgId}`;
      await admin`delete from leads where org_id = ${orgId}`;
      await admin`delete from orgs where id = ${orgId}`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("settings reader returns the org's booking config (lazy-created defaults)", async () => {
    const org = asOrgId(orgId);
    await withTenant(org, async (tx) => {
      const settings = await new DrizzleSettingsReader(tx, org).getByOrg(org);
      expect(settings).not.toBeNull();
      // EMPTY services and front desk OFF are the deliberate first-run state now: services come
      // from the shop's own trade playbook at signup (the nine invented plumbing services are
      // deleted), and an unconfigured assistant must not be the thing answering the phone.
      // This test used to assert the old defaults and was simply never updated when they changed.
      expect(settings!.props.booking.services).toEqual([]);
      expect(settings!.props.booking.serviceFee).toBe(89);
      expect(settings!.props.frontDesk).toBe(false);
    });
  });

  it("lead-summary reader returns name + open-work for the most-recent active job", async () => {
    const org = asOrgId(orgId);
    await withTenant(org, async (tx) => {
      const summary = await new DrizzleLeadSummaryReader(tx, org).summarize(asLeadId(leadWithJobId));
      expect(summary).not.toBeNull();
      expect(summary!.name).toBe("Dana Ruiz");
      // Ignores the completed job; formats the scheduled one.
      expect(summary!.openWork).toBe("job #142 scheduled Jul 16 (drain clear)");
    });
  });

  it("lead-summary reader returns name + null open-work when no active job", async () => {
    const org = asOrgId(orgId);
    await withTenant(org, async (tx) => {
      const summary = await new DrizzleLeadSummaryReader(tx, org).summarize(asLeadId(leadNoJobId));
      expect(summary).not.toBeNull();
      expect(summary!.name).toBe("No Jobs Nancy");
      expect(summary!.openWork).toBeNull();
    });
  });

  it("lead-summary reader returns null for a non-existent lead", async () => {
    const org = asOrgId(orgId);
    await withTenant(org, async (tx) => {
      const summary = await new DrizzleLeadSummaryReader(tx, org).summarize(
        asLeadId("00000000-0000-0000-0000-000000000000"),
      );
      expect(summary).toBeNull();
    });
  });
});
