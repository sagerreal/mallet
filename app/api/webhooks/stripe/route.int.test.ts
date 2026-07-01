import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { closeDb } from "@mallet/shared/db/client";
import { POST } from "./route";

// Capstone for the security-critical path: the REAL webhook route (signature verification -> raw
// body -> withTenant -> Drizzle repo -> live RLS + composite FK). We sign payloads with the same
// HMAC secret the route verifies against (STRIPE_WEBHOOK_SECRET), so a valid signature exercises
// the whole stack; a tampered body must be rejected before any DB work; and org/invoice come ONLY
// from the (verified) metadata, so a cross-tenant claim must be stopped by the composite FK under
// the claimed org's RLS scope — never a write to the real owner's invoice.
const hasEnv = Boolean(
  process.env.APP_DATABASE_URL &&
    process.env.DATABASE_URL &&
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_WEBHOOK_SECRET,
);
const suite = hasEnv ? describe : describe.skip;

const WEBHOOK_URL = "http://localhost/api/webhooks/stripe";

const piId = (): string => `pi_test_${randomUUID().replace(/-/g, "")}`;

const checkoutPaidEvent = (o: { orgId: string; invoiceId: string; amountCents: number; paymentIntent: string }) => ({
  id: `evt_test_${randomUUID().replace(/-/g, "")}`,
  object: "event",
  type: "checkout.session.completed",
  data: {
    object: {
      id: `cs_test_${randomUUID().replace(/-/g, "")}`,
      object: "checkout.session",
      payment_status: "paid",
      payment_intent: o.paymentIntent,
      amount_total: o.amountCents,
      currency: "usd",
      metadata: { orgId: o.orgId, invoiceId: o.invoiceId },
    },
  },
});

suite("stripe webhook route (signed payload, full stack, live RLS + FK)", () => {
  let admin: Sql;
  let stripe: Stripe;
  const secret = process.env.STRIPE_WEBHOOK_SECRET as string;

  let orgAId = "";
  let orgBId = "";
  let paidInvId = "";
  let tamperInvId = "";
  let crossTenantInvId = "";

  // Post a body + a signature computed over that EXACT body. `header` may be built from a
  // different `signedBody` to simulate tampering (signature valid for a body we then mutate).
  const post = async (body: string, signedBody = body): Promise<Response> => {
    const signature = stripe.webhooks.generateTestHeaderString({ payload: signedBody, secret });
    const req = new Request(WEBHOOK_URL, {
      method: "POST",
      headers: { "stripe-signature": signature, "content-type": "application/json" },
      body,
    });
    return POST(req);
  };

  const insertSentInvoice = async (orgId: string, leadId: string, num: string): Promise<string> => {
    const [row] = await admin<{ id: string }[]>`
      insert into invoices (org_id, num, lead_id, title, status, total_cents, amount_paid_cents, terms_days, sent_at, due_at)
      values (${orgId}, ${num}, ${leadId}, 'Webhook test', 'sent', 100000, 0, 7, now(), now() + interval '7 days')
      returning id`;
    return row!.id;
  };

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, { maxNetworkRetries: 0 });

    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('WebhookApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('WebhookApi B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    const [la] = await admin<{ id: string }[]>`insert into leads (org_id, name) values (${orgAId}, 'Cust A') returning id`;
    const leadAId = la!.id;

    paidInvId = await insertSentInvoice(orgAId, leadAId, "INV-9001");
    tamperInvId = await insertSentInvoice(orgAId, leadAId, "INV-9002");
    crossTenantInvId = await insertSentInvoice(orgAId, leadAId, "INV-9003");
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("records a validly-signed settled payment, marks the invoice paid, and is idempotent on redelivery", async () => {
    const pi = piId();
    const body = JSON.stringify(checkoutPaidEvent({ orgId: orgAId, invoiceId: paidInvId, amountCents: 100000, paymentIntent: pi }));

    const first = await post(body);
    expect(first.status).toBe(200);

    const afterFirst = await admin<{ status: string; amount_paid_cents: number }[]>`
      select status, amount_paid_cents from invoices where id = ${paidInvId}`;
    expect(afterFirst[0]).toMatchObject({ status: "paid", amount_paid_cents: 100000 });

    const paymentsAfterFirst = await admin<{ method: string; amount_cents: number; idempotency_key: string }[]>`
      select method, amount_cents, idempotency_key from payments where invoice_id = ${paidInvId}`;
    expect(paymentsAfterFirst).toHaveLength(1);
    expect(paymentsAfterFirst[0]).toMatchObject({ method: "card", amount_cents: 100000, idempotency_key: pi });

    // Stripe redelivers the SAME event (same payment_intent) — must not double-apply.
    const second = await post(body);
    expect(second.status).toBe(200);

    const afterSecond = await admin<{ amount_paid_cents: number }[]>`
      select amount_paid_cents from invoices where id = ${paidInvId}`;
    expect(afterSecond[0]!.amount_paid_cents).toBe(100000); // not 200000
    const paymentsAfterSecond = await admin<{ id: string }[]>`select id from payments where invoice_id = ${paidInvId}`;
    expect(paymentsAfterSecond).toHaveLength(1);
  });

  it("rejects a tampered body with 400 and records nothing", async () => {
    const pi = piId();
    const original = JSON.stringify(checkoutPaidEvent({ orgId: orgAId, invoiceId: tamperInvId, amountCents: 100000, paymentIntent: pi }));
    // Sign the original, then submit a body whose amount was bumped — signature must not verify.
    const tampered = original.replace('"amount_total":100000', '"amount_total":1');

    const res = await post(tampered, original);
    expect(res.status).toBe(400);

    const inv = await admin<{ status: string; amount_paid_cents: number }[]>`
      select status, amount_paid_cents from invoices where id = ${tamperInvId}`;
    expect(inv[0]).toMatchObject({ status: "sent", amount_paid_cents: 0 });
    const pay = await admin<{ id: string }[]>`select id from payments where invoice_id = ${tamperInvId}`;
    expect(pay).toHaveLength(0);
  });

  it("cannot record against another tenant's invoice even with a valid signature (cross-tenant metadata -> 500, no write)", async () => {
    const pi = piId();
    // Validly signed, but metadata claims org B while the invoice belongs to org A. The route scopes
    // the write to org B; the composite FK payments(org_id, invoice_id) has no matching parent, so
    // the insert throws -> 500. Org A's invoice is never touched.
    const body = JSON.stringify(checkoutPaidEvent({ orgId: orgBId, invoiceId: crossTenantInvId, amountCents: 100000, paymentIntent: pi }));

    const res = await post(body);
    expect(res.status).toBe(500);

    const inv = await admin<{ status: string; amount_paid_cents: number }[]>`
      select status, amount_paid_cents from invoices where id = ${crossTenantInvId}`;
    expect(inv[0]).toMatchObject({ status: "sent", amount_paid_cents: 0 });
    const pay = await admin<{ id: string }[]>`select id from payments where invoice_id = ${crossTenantInvId}`;
    expect(pay).toHaveLength(0);
    // And nothing leaked into org B's ledger either.
    const orgBPay = await admin<{ id: string }[]>`select id from payments where org_id = ${orgBId}`;
    expect(orgBPay).toHaveLength(0);
  });
});
