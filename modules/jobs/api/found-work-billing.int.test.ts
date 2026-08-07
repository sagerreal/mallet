/**
 * Found work reaches the bill — the regression that loses the shop money.
 *
 * The bug: a technician on site adds found work, the customer agrees, someone marks it approved,
 * and it is NEVER INVOICED. Approving an add-on flipped a status word and nothing else, and
 * CreateInvoiceFromJobUseCase bills from the job's LINES and has never read add-ons. Work done,
 * recorded, agreed, unbilled.
 *
 * This suite runs the whole chain against the live database with RLS on: sign the job, find more
 * work, take the customer's signature on it, complete, bill — and assert the found work is on the
 * invoice, in its total, and INSIDE what the customer authorised.
 *
 * The last of those is the part that cannot be taken on trust, so it is tested against a control:
 * the same job with an extra line NOBODY signed for must be flagged as an overage. If the guard
 * reported "fine" for both, it would be reporting nothing.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

const ctxFor = (userId: string, orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(userId), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: {
    authProvider: stubAuth,
    bus: new InMemoryEventBus(),
    clock: systemClock,
    ids: uuidGenerator,
    paymentLinkGateway: null,
    connectGateway: null,
    photoStorageGateway: null,
    llmClient: null,
    apiKeyAuthenticator: { authenticate: async () => null },
    tokenVerifier: { verify: async () => null },
    signupStore: {
      createOrgForUser: async () => {
        throw new Error("unused in this test");
      },
    },
  },
});

const SIGNED_JOB_CENTS = 150_000;
const FOUND_WORK_CENTS = 24_000;

suite("found work reaches the bill (live RLS)", () => {
  let admin: Sql;
  let orgId = "";
  let techId = "";
  let ownerId = "";
  let leadId = "";

  const tech = () => appRouter.createCaller(ctxFor(techId, orgId, "tech"));
  const owner = () => appRouter.createCaller(ctxFor(ownerId, orgId, "owner"));

  /** A scheduled work job assigned to the tech — the state a technician actually arrives to. */
  const seedJob = async (): Promise<string> => {
    const [job] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, kind, assignee_user_id, title)
      values (${orgId}, ${leadId}, ${"JOB-" + randomUUID().slice(0, 8)}, 'scheduled', 0, 'work',
              ${techId}, 'Water heater swap')
      returning id`;
    return job!.id;
  };

  /** Completion is not what this suite is testing — the bill just needs the job closed. */
  const markComplete = async (jobId: string): Promise<void> => {
    await admin`update jobs set status = 'complete', completed_at = now() where id = ${jobId}`;
  };

  /** The tech prices the job on the tablet and the customer signs it — the ORIGINAL agreement. */
  const signOriginal = async (jobId: string): Promise<void> => {
    await tech().v1.field.signQuote({
      jobId,
      lines: [
        { description: "Water heater swap", quantity: 1, rateCents: SIGNED_JOB_CENTS, costCents: 0 },
      ],
      signerName: "Dave Chen",
      signatureSvg: "M10,10 L40,30",
    });
  };

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });

    const [org] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('Found Work Billing ' || gen_random_uuid()) returning id`;
    orgId = org!.id;

    const mkUser = async (email: string, role: string): Promise<string> => {
      const [u] = await admin<{ id: string }[]>`
        insert into users (org_id, auth_user_id, email, role)
        values (${orgId}, ${randomUUID()}, ${email}, ${role})
        returning id`;
      return u!.id;
    };
    techId = await mkUser(`tech-${randomUUID()}@foundwork.test`, "tech");
    ownerId = await mkUser(`owner-${randomUUID()}@foundwork.test`, "owner");

    const [lead] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Found Work Customer') returning id`;
    leadId = lead!.id;
  });

  afterAll(async () => {
    if (orgId) {
      // Teardown order matters. job_visits and time_entries carry composite FKs onto users, and
      // job_addons.approval_estimate_id now references estimates with NO cascade — so an org
      // delete tries to remove the addendum out from under the add-on that points at it. That FK
      // is deliberate (an approval must not outlive its evidence); tenant data is soft-deleted in
      // production and never hard-deleted, so only test teardown has to unwind it by hand.
      await admin`delete from job_addons where org_id = ${orgId}`;
      await admin`delete from job_visits where org_id = ${orgId}`;
      await admin`delete from time_entries where org_id = ${orgId}`;
      await admin`delete from orgs where id = ${orgId}`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("the customer signs for found work and it is ON the bill, in the total", async () => {
    const jobId = await seedJob();
    await signOriginal(jobId);

    // More work found at the van.
    const withAddon = await tech().v1.field.addAddon({
      jobId,
      description: "Expansion tank",
      rateCents: FOUND_WORK_CENTS,
    });
    const addonId = withAddon.addons[0]!.id;
    expect(withAddon.addons[0]!.status).toBe("proposed");

    // The customer signs the addendum on the same tablet.
    const approved = await tech().v1.field.approveFoundWork({
      jobId,
      addonIds: [addonId],
      signerName: "Dave Chen",
      signatureSvg: "M10,10 L40,30",
    });
    expect(approved.addons.find((a) => a.id === addonId)?.status).toBe("approved");
    // The wire to money: the add-on's work is now a JOB LINE, alongside what was signed before it.
    expect(approved.lines.map((l) => l.description)).toEqual(["Water heater swap", "Expansion tank"]);

    await markComplete(jobId);
    const invoice = await owner().v1.invoicing.createFromJob({ jobId });

    const billed = invoice.lines.find((l) => l.description === "Expansion tank");
    expect(billed, "found work must be a line on the invoice").toBeTruthy();
    expect(billed?.rate.cents).toBe(FOUND_WORK_CENTS);
    expect(invoice.total.cents).toBe(SIGNED_JOB_CENTS + FOUND_WORK_CENTS);
  });

  it("the signed addendum lifts what the customer authorised, so the bill is not flagged", async () => {
    const jobId = await seedJob();
    await signOriginal(jobId);
    const withAddon = await tech().v1.field.addAddon({
      jobId,
      description: "Expansion tank",
      rateCents: FOUND_WORK_CENTS,
    });
    await tech().v1.field.approveFoundWork({
      jobId,
      addonIds: [withAddon.addons[0]!.id],
      signerName: "Dave Chen",
      signatureSvg: "M10,10 L40,30",
    });

    await markComplete(jobId);
    const created = await owner().v1.invoicing.createFromJob({ jobId });
    const read = await owner().v1.invoicing.get({ invoiceId: created.id });

    expect(read.authorization).toBeTruthy();
    expect(read.authorization?.authorizedCents).toBe(SIGNED_JOB_CENTS + FOUND_WORK_CENTS);
    expect(read.authorization?.overage).toBeNull();
  });

  // The control. Without it the assertion above proves nothing — a guard that answers "fine" to
  // everything would pass it too.
  it("work NOBODY signed for is still flagged as an overage", async () => {
    const jobId = await seedJob();
    await signOriginal(jobId);
    // The office adds a line straight onto the job. No addendum, no signature, no approval.
    await owner().v1.jobs.addLine({
      jobId,
      description: "Extra circuit",
      quantity: 1,
      rateCents: 30_000,
      costCents: 0,
    });

    await markComplete(jobId);
    const created = await owner().v1.invoicing.createFromJob({ jobId });
    const read = await owner().v1.invoicing.get({ invoiceId: created.id });

    expect(read.total.cents).toBe(SIGNED_JOB_CENTS + 30_000);
    expect(read.authorization?.authorizedCents).toBe(SIGNED_JOB_CENTS);
    expect(read.authorization?.overage?.excessCents).toBe(30_000);
  });

  it("approving twice is refused and never bills the same work twice", async () => {
    const jobId = await seedJob();
    await signOriginal(jobId);
    const withAddon = await tech().v1.field.addAddon({
      jobId,
      description: "Expansion tank",
      rateCents: FOUND_WORK_CENTS,
    });
    const addonId = withAddon.addons[0]!.id;
    const approval = {
      jobId,
      addonIds: [addonId],
      signerName: "Dave Chen",
      signatureSvg: "M10,10 L40,30",
    };
    await tech().v1.field.approveFoundWork(approval);
    await expect(tech().v1.field.approveFoundWork(approval)).rejects.toMatchObject({
      message: expect.stringContaining("already been settled"),
    });

    await markComplete(jobId);
    const invoice = await owner().v1.invoicing.createFromJob({ jobId });
    expect(invoice.lines.filter((l) => l.description === "Expansion tank")).toHaveLength(1);
    expect(invoice.total.cents).toBe(SIGNED_JOB_CENTS + FOUND_WORK_CENTS);
  });

  it("a tech who is not on the job cannot sign its found work", async () => {
    const jobId = await seedJob();
    await signOriginal(jobId);
    const withAddon = await tech().v1.field.addAddon({
      jobId,
      description: "Expansion tank",
      rateCents: FOUND_WORK_CENTS,
    });
    const [other] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, ${`stranger-${randomUUID()}@foundwork.test`}, 'tech')
      returning id`;
    const stranger = appRouter.createCaller(ctxFor(other!.id, orgId, "tech"));

    await expect(
      stranger.v1.field.approveFoundWork({
        jobId,
        addonIds: [withAddon.addons[0]!.id],
        signerName: "Dave Chen",
        signatureSvg: "M10,10 L40,30",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("the addendum is a signed change order against this job — the evidence, not just a flag", async () => {
    const jobId = await seedJob();
    await signOriginal(jobId);
    const withAddon = await tech().v1.field.addAddon({
      jobId,
      description: "Expansion tank",
      rateCents: FOUND_WORK_CENTS,
    });
    const addonId = withAddon.addons[0]!.id;
    await tech().v1.field.approveFoundWork({
      jobId,
      addonIds: [addonId],
      signerName: "Dave Chen",
      signatureSvg: "M10,10 L40,30",
    });

    const [row] = await admin<
      {
        approved_by_user_id: string | null;
        approved_at: Date | null;
        approval_estimate_id: string | null;
      }[]
    >`select approved_by_user_id, approved_at, approval_estimate_id
        from job_addons where id = ${addonId}`;
    expect(row?.approved_by_user_id).toBe(techId);
    expect(row?.approved_at).toBeTruthy();
    expect(row?.approval_estimate_id).toBeTruthy();

    const [addendum] = await admin<
      { signer_name: string | null; status: string; change_order_for_job_id: string | null; signed_snapshot: unknown }[]
    >`select signer_name, status, change_order_for_job_id, signed_snapshot
        from estimates where id = ${row!.approval_estimate_id}`;
    expect(addendum?.signer_name).toBe("Dave Chen");
    expect(addendum?.status).toBe("accepted");
    expect(addendum?.change_order_for_job_id).toBe(jobId);
    expect((addendum?.signed_snapshot as { totalCents: number }).totalCents).toBe(FOUND_WORK_CENTS);
  });
});
