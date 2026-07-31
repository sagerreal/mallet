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

/**
 * The Money ledger's own order, ported from STATUS_RANK: draft, overdue, partial, sent, paid.
 * `over` is not a database status — it is a sent invoice past its due date — so the order comes
 * from a CASE expression, and the cursor has to carry the rank or page two restarts at draft.
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

suite("invoices — ledger order", () => {
  let admin: Sql;
  let orgId = "";
  let leadId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('Ledger ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const [l] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Ledger Customer') returning id`;
    leadId = l!.id;

    // paidCents matters: the ledger bands an invoice by its BALANCE, not by its status text —
    // same rule the screen paints pills with (invStatusKey). A row marked 'paid' with the whole
    // total still owing is a state applyPayment cannot produce, so seeding one would be testing
    // against data the app never creates.
    const add = (num: string, status: string, dueOffsetDays: number | null, paidCents = 0) =>
      admin`insert into invoices (org_id, lead_id, num, status, total_cents, amount_paid_cents, due_at)
            values (${orgId}, ${leadId}, ${num}, ${status}, 10000, ${paidCents},
              ${dueOffsetDays === null ? null : sqlOffset(dueOffsetDays)})`;
    const sqlOffset = (d: number) => new Date(Date.now() + d * 86_400_000);

    await add("L-PAID", "paid", -50, 10000);   // settled — nothing owing, so not overdue
    await add("L-SENT", "sent", 30);           // due in future -> plain sent
    await add("L-OVER", "sent", -5);           // sent and past due -> overdue
    await add("L-PARTIAL", "partial", 10, 4000);
    await add("L-DRAFT", "draft", null);
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("orders draft, overdue, partial, sent, paid — the ledger's workflow order", () => {
    return (async () => {
      const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
      const page = await caller.v1.invoicing.list({ sort: "ledger", limit: 50 });
      expect(page.items.map((i) => i.num)).toEqual(["L-DRAFT", "L-OVER", "L-PARTIAL", "L-SENT", "L-PAID"]);
    })();
  });

  it("resumes INSIDE the right band across a page boundary", () => {
    // The cursor carries the computed rank. Without it page two restarts at draft and the ledger
    // repeats its top rows forever.
    return (async () => {
      const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
      const nums: string[] = [];
      let cursor: string | null = null;
      for (let g = 0; g < 10; g++) {
        const page = await caller.v1.invoicing.list({ sort: "ledger", limit: 2, cursor });
        nums.push(...page.items.map((i) => i.num));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      expect(nums).toEqual(["L-DRAFT", "L-OVER", "L-PARTIAL", "L-SENT", "L-PAID"]);
      expect(new Set(nums).size).toBe(5);
    })();
  });
});
