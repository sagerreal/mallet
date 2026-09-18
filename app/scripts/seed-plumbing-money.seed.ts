/**
 * Second half of the plumbing demo seed: take the two oldest scheduled jobs all the way to money.
 *
 * Split from the main seed because the first run silently produced no invoices. A job cannot go
 * scheduled -> complete: the domain refuses with "only an in-progress job can be completed", so
 * START is a required step, not an optional one. The original script swallowed that in a
 * .catch(() => {}), which is exactly how a seed ends up looking like it worked.
 *
 *   npx vitest run --config vitest.integration.config.ts scripts/seed-plumbing-money
 */
import { describe, it, expect } from "vitest";
import { appRouter } from "@/trpc/root";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import postgres from "postgres";

const ORG_ID = "6d2ceccc-e7bb-4d43-904d-d23c01cf9528";
const OWNER_ID = "f667e57e-7159-439a-b873-52d896e0fcd9";

const ctx = {
  principal: { userId: asUserId(OWNER_ID), orgId: asOrgId(ORG_ID), role: "owner" as const },
  unmapped: null,
  tx: null,
  deps: {
    authProvider: { authenticate: async () => { throw new Error("unused"); } },
    bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator,
    paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null, llmClient: null,
    apiKeyAuthenticator: { authenticate: async () => null },
    tokenVerifier: { verify: async () => null },
    signupStore: { createOrgForUser: async () => { throw new Error("unused"); } },
  },
};

describe("seed: money side", () => {
  it("bills two finished jobs — one paid, one still owed", async () => {
    const office = appRouter.createCaller(ctx as never);
    const sql = postgres(process.env.DATABASE_URL as string, { ssl: "require", max: 1 });

    // The jobs this seed created that are still scheduled and carry a real total.
    const rows = await sql<{ id: string; num: string; total_cents: number }[]>`
      select id, num, total_cents from jobs
      where org_id = ${ORG_ID} and status = 'scheduled' and deleted_at is null and total_cents > 0
      order by created_at desc limit 2`;
    await sql.end();
    expect(rows.length).toBeGreaterThan(0);

    for (const [i, j] of rows.entries()) {
      await office.v1.jobs.start({ jobId: j.id });
      await office.v1.jobs.complete({ jobId: j.id });

      const inv = await office.v1.invoicing.createFromJob({ jobId: j.id });
      await office.v1.invoicing.send({ invoiceId: inv.id });

      // First one paid in full, second left open so the Money screen shows both states.
      if (i === 0) {
        await office.v1.invoicing.recordPayment({
          invoiceId: inv.id,
          amountCents: inv.total.cents,
          method: "card",
          idempotencyKey: `seed-${inv.id}`,
        });
      }
      console.log(`  ${j.num} -> invoice ${inv.num} $${(inv.total.cents / 100).toFixed(2)} ${i === 0 ? "PAID" : "OPEN"}`);
    }
    await closeDb();
  }, 180_000);
});
