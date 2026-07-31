import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { AuthProvider, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";
import { INVOICE_VIEWS } from "../infra/invoice-views";
import { invStatusKey } from "@/features/money/money-derive";
import type { Invoice } from "@/lib/store/types";

/**
 * The ledger's status bands in SQL, checked against the SAME rule the screen paints pills with.
 *
 * Two definitions of "overdue" in two languages is exactly the drift that produced the bug this
 * replaces: the sort called an invoice overdue on `due_at < now()`, the screen called it overdue
 * at seven days old, and the store mapper hard-coded that age to 0 so the pill never appeared at
 * all. The test below is deliberately not a restatement of the SQL — it runs the CLIENT function
 * over the same rows and asserts the two agree.
 */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = { authenticate: async () => { throw new Error("unused"); } };
const ctxFor = (orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role },
  unmapped: null, tx: null,
  deps: {
    authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator,
    paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null, llmClient: null,
    apiKeyAuthenticator: { authenticate: async () => null },
    tokenVerifier: { verify: async () => null },
    signupStore: { createOrgForUser: async () => { throw new Error("unused"); } },
  },
});

suite("invoice ledger views", () => {
  let admin: Sql;
  let orgId = "";
  let leadId = "";

  /**
   * Amounts in CENTS, matching the columns — the DTO converts on the way out.
   *
   * A payment writes BOTH the header total and a payments row, because that is what applyPayment
   * does and because the two sides read different ones: the SQL bands use amount_paid_cents, while
   * the client sums the payment rows the DTO carries. Setting only the column here made the first
   * run of this test fail — a useful reminder that those two must be written together, which is
   * why applyPayment owns that increment exclusively (see drizzle-invoice-repository.ts:71).
   */
  const addInvoice = async (
    num: string,
    status: string,
    totalCents: number,
    paidCents: number,
    dueAt: string | null,
  ) => {
    const [i] = await admin<{ id: string }[]>`
      insert into invoices (org_id, lead_id, num, status, total_cents, amount_paid_cents, due_at)
      values (${orgId}, ${leadId}, ${num}, ${status}, ${totalCents}, ${paidCents}, ${dueAt})
      returning id`;
    if (paidCents > 0) {
      await admin`
        insert into payments (org_id, invoice_id, amount_cents, method, idempotency_key, received_at)
        values (${orgId}, ${i!.id}, ${paidCents}, 'card', ${`views-test-${num}`}, now())`;
    }
    return i!.id;
  };

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('InvViews ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const [l] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Ledger Customer') returning id`;
    leadId = l!.id;

    await addInvoice("LV-DRAFT1", "draft", 50000, 0, null);
    await addInvoice("LV-DRAFT2", "draft", 30000, 0, "2020-01-01"); // a draft is never overdue
    await addInvoice("LV-OVER1", "sent", 60000, 0, "2020-01-01");
    await addInvoice("LV-OVER2", "partial", 40000, 10000, "2020-01-01"); // overdue beats part-paid
    await addInvoice("LV-PARTIAL", "partial", 40000, 15000, "2999-01-01");
    await addInvoice("LV-SENT1", "sent", 20000, 0, "2999-01-01");
    await addInvoice("LV-SENT2", "sent", 20000, 0, null); // no due date is not overdue
    await addInvoice("LV-PAID1", "paid", 25000, 25000, "2020-01-01"); // settled, so not overdue
    await addInvoice("LV-PAID2", "sent", 25000, 25000, "2020-01-01"); // paid off, status not updated
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("puts each invoice in exactly one band, accounting for all of them", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const seen = new Map<string, string>();
    for (const view of INVOICE_VIEWS) {
      const page = await caller.v1.invoicing.list({ view, limit: 100 });
      for (const i of page.items) {
        expect(seen.has(i.id), `${i.num} is in both ${seen.get(i.id)} and ${view}`).toBe(false);
        seen.set(i.id, view);
      }
    }
    const [total] = await admin<{ n: number }[]>`
      select count(*)::int n from invoices where org_id = ${orgId} and deleted_at is null`;
    expect(seen.size).toBe(total!.n);
  });

  it("bands the rows the way the screen does — one rule, two languages", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const all = await caller.v1.invoicing.list({ limit: 100 });

    for (const summary of all.items) {
      const full = await caller.v1.invoicing.get({ invoiceId: summary.id });
      // The shape money-derive reads. Amounts in DOLLARS, as the store holds them.
      const asStore = {
        status: full.status,
        total: full.total.cents / 100,
        depPaid: full.depositPaid.cents / 100,
        payments: full.payments.map((p) => ({ amt: p.amount.cents / 100, when: "", method: p.method })),
        dueAt: full.dueAt,
      } as unknown as Invoice;

      const fromServer = await caller.v1.invoicing.count({
        view: invStatusKey(asStore) as (typeof INVOICE_VIEWS)[number],
      });
      expect(fromServer.total, `${summary.num}: no server band matches the client's`).toBeGreaterThan(0);

      // And specifically: this invoice is in the band the client named.
      const band = await caller.v1.invoicing.list({
        view: invStatusKey(asStore) as (typeof INVOICE_VIEWS)[number],
        limit: 100,
      });
      expect(
        band.items.some((i) => i.id === summary.id),
        `${summary.num}: client says ${invStatusKey(asStore)}, server disagrees`,
      ).toBe(true);
    }
  });

  // The Dashboard states these as fact on the first screen of the app. It used to add them up
  // from the invoices the browser had loaded — one page — so on the real org it showed $0 owed
  // while a genuinely open invoice sat outside that window.
  it("sums what is owed across the WHOLE book, not a page of it", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const { openCents, overdueCents, openCount } = await caller.v1.invoicing.totals();

    // LV-OVER1 60000, LV-OVER2 40000-10000=30000, LV-PARTIAL 40000-15000=25000,
    // LV-SENT1 20000, LV-SENT2 20000. Drafts and settled invoices owe nothing.
    expect(openCents).toBe(60000 + 30000 + 25000 + 20000 + 20000);
    expect(openCount).toBe(5);
    // Only the two past their due date.
    expect(overdueCents).toBe(60000 + 30000);
  });

  it("excludes drafts from what is owed — nothing was ever sent", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const { openCount } = await caller.v1.invoicing.totals();
    const drafts = await caller.v1.invoicing.count({ view: "draft" });
    expect(drafts.total).toBe(2);
    expect(openCount).toBe(5); // the 2 drafts are not among them
  });

  it("counts each band", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const countOf = async (view: (typeof INVOICE_VIEWS)[number]) =>
      (await caller.v1.invoicing.count({ view })).total;

    expect(await countOf("draft")).toBe(2);
    expect(await countOf("over")).toBe(2);   // sent-overdue + partial-overdue
    expect(await countOf("partial")).toBe(1);
    expect(await countOf("sent")).toBe(2);   // future due date + no due date
    expect(await countOf("paid")).toBe(2);   // status paid + balance closed
  });
});
