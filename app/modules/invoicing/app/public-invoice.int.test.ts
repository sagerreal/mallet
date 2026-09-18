import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { AuthProvider, Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";
import { getPublicInvoice } from "./public-invoice";

/**
 * The customer's own copy of the bill, resolved end-to-end against the live database.
 *
 * The defect this guards: `/i/<token>` rendered the org NAME, a status pill, line items, totals
 * and a Pay button — and nothing else. Not the customer's own name. No company address, phone or
 * licence. No service address, no invoice date, no service date. A payment page, not a document.
 *
 * It is also the ONE unauthenticated read in the invoicing module, so the tenant assertions are
 * not ceremony: the org is resolved FROM the bearer token, and every fact the page now states has
 * to come from that org and no other.
 */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = {
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

const SERVICE_AT = new Date("2026-08-03T16:20:00.000Z");

suite("getPublicInvoice — the customer's document of record (live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let ownerAId = "";
  let ownerBId = "";
  /** Org A's bill: an addressed lead, a job whose visit completed, business details filled in. */
  let tokenA = "";
  /** Org B's bill: a lead with NO address and a job with no completed visit. */
  let tokenB = "";

  const mkOrg = async (label: string): Promise<string> => {
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values (${label + " " + randomUUID()}) returning id`;
    return o!.id;
  };

  const mkUser = async (org: string, role: string): Promise<string> => {
    const [u] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${org}, ${randomUUID()}, ${`u-${randomUUID()}@pubinv.test`}, ${role})
      returning id`;
    return u!.id;
  };

  const mkLead = async (org: string, name: string, address: string | null): Promise<string> => {
    const [l] = await admin<{ id: string }[]>`
      insert into leads (org_id, name, address) values (${org}, ${name}, ${address}) returning id`;
    return l!.id;
  };

  const mkJob = async (org: string, leadId: string): Promise<string> => {
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, kind, completed_at)
      values (${org}, ${leadId}, ${"JOB-" + randomUUID().slice(0, 8)}, 'complete', 60000, 'work', now())
      returning id`;
    return j!.id;
  };

  /** Raise the bill through the real router, then send it so a public token is minted. */
  const mkSentInvoice = async (org: string, owner: string, jobId: string): Promise<string> => {
    const caller = appRouter.createCaller(ctxFor(owner, org, "owner"));
    const invoice = await caller.v1.invoicing.createFromJob({ jobId });
    await caller.v1.invoicing.send({ invoiceId: invoice.id });
    const [row] = await admin<{ public_token: string }[]>`
      select public_token from invoices where id = ${invoice.id}`;
    return row!.public_token;
  };

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    orgAId = await mkOrg("PubInv A");
    orgBId = await mkOrg("PubInv B");
    ownerAId = await mkUser(orgAId, "owner");
    ownerBId = await mkUser(orgBId, "owner");

    // Org A — a shop that filled in Settings → Business details.
    await appRouter.createCaller(ctxFor(ownerAId, orgAId, "owner")).v1.settings.updateBusiness({
      address: "200 Ray St, Pleasanton, CA 94566",
      phone: "(925) 555-0100",
      email: "billing@ridgeline.test",
      license: "C36-1029384",
    });
    const leadA = await mkLead(orgAId, "Dana Whitfield", "18 Aspen Ct, Dublin, CA 94568");
    const jobA = await mkJob(orgAId, leadA);
    // The stamp the technician's tap wrote. This — not the job's completed_at, not the schedule —
    // is what the document may call the service date.
    await admin`
      insert into job_visits (org_id, job_id, status, completed_at, position)
      values (${orgAId}, ${jobA}, 'complete', ${SERVICE_AT}, 0)`;
    tokenA = await mkSentInvoice(orgAId, ownerAId, jobA);

    // Org B — nothing filled in, an addressless lead, and a job nobody has finished a visit on.
    const leadB = await mkLead(orgBId, "Sam Okafor", null);
    const jobB = await mkJob(orgBId, leadB);
    await admin`
      insert into job_visits (org_id, job_id, status, position)
      values (${orgBId}, ${jobB}, 'pending', 0)`;
    tokenB = await mkSentInvoice(orgBId, ownerBId, jobB);
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("states who billed, who was billed, where the work happened and when", async () => {
    const view = await getPublicInvoice(tokenA);
    expect(view).not.toBeNull();
    if (!view) return;

    expect(view.orgName).toMatch(/^PubInv A /);
    expect(view.business).toEqual({
      address: "200 Ray St, Pleasanton, CA 94566",
      phone: "(925) 555-0100",
      email: "billing@ridgeline.test",
      site: null,
      license: "C36-1029384",
    });
    expect(view.customerName).toBe("Dana Whitfield");
    expect(view.serviceAddress).toBe("18 Aspen Ct, Dublin, CA 94568");
    expect(view.serviceAt).toEqual(SERVICE_AT);
    expect(view.invoicedAt).toBeInstanceOf(Date);
  });

  it("keeps the shop's NAME out of the business block — the branded header prints it", async () => {
    const view = await getPublicInvoice(tokenA);
    expect(Object.keys(view?.business ?? {}).sort()).toEqual([
      "address",
      "email",
      "license",
      "phone",
      "site",
    ]);
  });

  it("omits what is genuinely unset rather than printing a blank or a wrong date", async () => {
    // Org B never opened Settings, its lead has no address, and no visit has completed. Every one
    // of those is null — above all the service date, which must NOT fall back to the invoice date:
    // a customer may hand this page to an insurer or a warranty desk.
    const view = await getPublicInvoice(tokenB);
    expect(view).not.toBeNull();
    if (!view) return;

    expect(view.business).toEqual({
      address: null,
      phone: null,
      email: null,
      site: null,
      license: null,
    });
    expect(view.serviceAddress).toBeNull();
    expect(view.serviceAt).toBeNull();
    // …while the facts it DOES have are still there.
    expect(view.customerName).toBe("Sam Okafor");
    expect(view.invoicedAt).toBeInstanceOf(Date);
  });

  it("scopes every new field to the token's OWN org", async () => {
    // The page is unauthenticated and the org comes from the token. Org B's bill must not pick up
    // org A's licence, address or customer, and vice versa.
    const [a, b] = await Promise.all([getPublicInvoice(tokenA), getPublicInvoice(tokenB)]);
    expect(a?.business.license).toBe("C36-1029384");
    expect(b?.business.license).toBeNull();
    expect(a?.customerName).toBe("Dana Whitfield");
    expect(b?.customerName).toBe("Sam Okafor");
    expect(b?.orgName).toMatch(/^PubInv B /);
  });

  it("returns null for a token that matches no live invoice", async () => {
    expect(await getPublicInvoice("f".repeat(64))).toBeNull();
  });

  it("carries the shop's document wording, and the standard sentences for an untouched shop", async () => {
    // Org A sets its wording in Settings → Documents; org B never touches it. The same token
    // read must resolve A's own sentences and B's standard ones — org-scoped, like everything
    // else on this page.
    await appRouter.createCaller(ctxFor(ownerAId, orgAId, "owner")).v1.settings.updateDocuments({
      invoiceFooter: "1-year warranty on labor.",
      payInstructions: "Zelle to (925) 555-0100.",
      receiptNote: "Paid in full — thank you!",
    });

    const [a, b] = await Promise.all([getPublicInvoice(tokenA), getPublicInvoice(tokenB)]);
    expect(a?.footerNote).toBe("1-year warranty on labor.");
    expect(a?.payInstructions).toBe("Zelle to (925) 555-0100.");
    expect(a?.receiptNote).toBe("Paid in full — thank you!");

    expect(b?.footerNote).toBeNull();
    expect(b?.payInstructions).toMatch(/^To pay this invoice, contact PubInv B .* directly\.$/);
    expect(b?.receiptNote).toBe(
      "This invoice is settled in full. Keep this link for your records.",
    );
  });
});
