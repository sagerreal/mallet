import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { asOrgId, type OrgId } from "@mallet/shared/types";
import { A2pRegistration } from "../domain/registration";
import { DrizzleRegistrationRepository } from "./drizzle-registration-repository";

// Skipped when DB credentials are absent (see vitest.int.setup.ts for env loading).
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

// NOTE: the brief's literal fixture org id (22222222-2222-2222-2222-222222222222) does not
// exist in this live shared DB (verified directly against `orgs` — only "E2E Plumbing" /
// ce820b1f... and "Summit Commercial Cleaning" / 6d2ceccc... exist, plus throwaway test orgs).
// Following every other *.int.test.ts in this repo (e.g. drizzle-task-repository.int.test.ts,
// drizzle-notification-repository.int.test.ts), this suite creates its own throwaway org via a
// direct admin connection and tears it down afterward, rather than depending on a fixture row
// that isn't actually present.
suite("DrizzleRegistrationRepository (live RLS)", () => {
  let admin: Sql;
  let orgId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [row] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('A2pRegoRepo ' || gen_random_uuid()) returning id`;
    orgId = row!.id;
  });

  afterAll(async () => {
    if (orgId) {
      // a2p_registrations.org_id has no ON DELETE CASCADE, so clear it before the org.
      await admin`delete from a2p_registrations where org_id = ${orgId}`;
      await admin`delete from orgs where id = ${orgId}`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("upserts and reads back a registration for the tenant", async () => {
    const ORG: OrgId = asOrgId(orgId);
    await withTenant(ORG, async (tx) => {
      const repo = new DrizzleRegistrationRepository(tx, ORG);
      const created = A2pRegistration.create({
        orgId: ORG,
        status: "profile_pending",
        secondaryProfileSid: "BUtest",
        brandSid: null,
        messagingServiceSid: null,
        campaignSid: null,
        phoneNumberSid: null,
        businessInfo: null,
        otpVerified: false,
        failureReason: null,
      });
      if (!created.ok) throw new Error();
      await repo.save(created.value);
      const got = await repo.get(ORG);
      expect(got?.props.secondaryProfileSid).toBe("BUtest");
      expect(got?.props.status).toBe("profile_pending");
    });
  });
});
