import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, ok, err, externalService, type OrgId, type Result, type AppError } from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { closeOwnerDb } from "@mallet/shared/db/owner-client";
import { outbox } from "@mallet/shared/db/schema";
import { runOutboxRelay } from "./relay";
import type { OutboxEvent, OutboxHandler, OutboxHandlerMap, RelayHandlerContext } from "./handler";
import { buildOutboxHandlers } from "@/trpc/outbox-registry";

// The relay engine against live RLS: owner-conn CLAIM -> withTenant DISPATCH -> MARK. Seeds via the
// admin (owner) connection. The relay is global (all orgs), so each test first publishes any
// pre-existing unpublished rows to isolate its own seeded rows.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const handler = (fn: (e: OutboxEvent, c: RelayHandlerContext) => Promise<Result<void, AppError>>): OutboxHandler => ({ handle: fn });
const map = (entries: Array<[string, OutboxHandler]>): OutboxHandlerMap => new Map(entries);

suite("outbox relay (engine, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";
  let sentInvAId = "";

  const clearOutbox = () => admin`update outbox set published_at = now() where published_at is null`;
  const seed = (orgId: string, name: string, payload: Record<string, unknown> = {}) =>
    admin<{ id: string; seq: string }[]>`
      insert into outbox (org_id, event_name, payload, occurred_at)
      values (${orgId}, ${name}, ${JSON.stringify(payload)}::jsonb, now()) returning id, seq`;
  const row = (id: string) =>
    admin<{ published_at: string | null; attempts: number; last_error: string | null }[]>`
      select published_at, attempts, last_error from outbox where id = ${id}`;

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('Relay A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('Relay B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    const [la] = await admin<{ id: string }[]>`insert into leads (org_id, name) values (${orgAId}, 'Relay Cust') returning id`;
    leadAId = la!.id;
    const [inv] = await admin<{ id: string }[]>`
      insert into invoices (org_id, num, lead_id, status, total_cents, sent_at, due_at)
      values (${orgAId}, 'INV-RELAY-1', ${leadAId}, 'sent', 50000, now(), now() + interval '7 days') returning id`;
    sentInvAId = inv!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeOwnerDb();
    await closeDb();
  });

  it("publishes handled events, drains events with no handler, and dispatches under the correct org in seq order", async () => {
    await clearOutbox();
    const tag = randomUUID();
    const seen: Array<{ orgId: string; name: string; seq: number }> = [];
    const rec = handler(async (e) => {
      seen.push({ orgId: e.orgId, name: e.name, seq: e.seq });
      return ok(undefined);
    });
    const [r1] = await seed(orgAId, `t.one.${tag}`);
    const [r2] = await seed(orgBId, `t.one.${tag}`); // different org, same handler
    const [rNo] = await seed(orgAId, `t.nohandler.${tag}`);

    const summary = await runOutboxRelay(map([[`t.one.${tag}`, rec]]));

    expect(summary.published).toBeGreaterThanOrEqual(2);
    expect(summary.drainedNoOp).toBeGreaterThanOrEqual(1);
    expect((await row(r1!.id))[0]!.published_at).not.toBeNull();
    expect((await row(r2!.id))[0]!.published_at).not.toBeNull();
    expect((await row(rNo!.id))[0]!.published_at).not.toBeNull(); // drained
    // dispatched under the right tenant, oldest seq first
    const mine = seen.filter((s) => s.name === `t.one.${tag}`);
    expect(mine.map((s) => s.orgId)).toEqual([orgAId, orgBId]);
    expect(mine[1]!.seq).toBeGreaterThan(mine[0]!.seq);
  });

  it("leaves a retryable failure unpublished with a SAFE last_error, and stops at the poison cap", async () => {
    await clearOutbox();
    const tag = randomUUID();
    const fail = handler(async () => err(externalService("twilio", "To +15555550123 is invalid", true)));
    const [r] = await seed(orgAId, `t.fail.${tag}`);
    const handlers = map([[`t.fail.${tag}`, fail]]);

    const s1 = await runOutboxRelay(handlers, { maxAttempts: 2 });
    expect(s1.failed).toBe(1);
    let cur = (await row(r!.id))[0]!;
    expect(cur.published_at).toBeNull();
    expect(cur.attempts).toBe(1);
    expect(cur.last_error).toBe("external_service:twilio"); // no PII
    expect(cur.last_error).not.toContain("+15555550123");

    const s2 = await runOutboxRelay(handlers, { maxAttempts: 2 });
    expect(s2.poisoned).toBe(1); // attempts hit the cap
    cur = (await row(r!.id))[0]!;
    expect(cur.attempts).toBe(2);
    expect(cur.published_at).toBeNull();

    const s3 = await runOutboxRelay(handlers, { maxAttempts: 2 });
    expect(s3.claimed).toBe(0); // poisoned row is no longer claimed — a visible dead-letter
  });

  it("catches a throwing handler ('unhandled', unpublished) and keeps dispatching the rest of the batch", async () => {
    await clearOutbox();
    const tag = randomUUID();
    const afterSeen: string[] = [];
    const throwing = handler(async () => {
      throw new Error("kaboom leaking +15555550123");
    });
    const afterH = handler(async (e) => {
      afterSeen.push(e.name);
      return ok(undefined);
    });
    const [rThrow] = await seed(orgAId, `t.throw.${tag}`);
    const [rAfter] = await seed(orgAId, `t.after.${tag}`); // higher seq -> dispatched after the throw

    await runOutboxRelay(map([[`t.throw.${tag}`, throwing], [`t.after.${tag}`, afterH]]));

    const t = (await row(rThrow!.id))[0]!;
    expect(t.published_at).toBeNull();
    expect(t.last_error).toBe("unhandled");
    expect(t.last_error).not.toContain("+15555550123");
    expect((await row(rAfter!.id))[0]!.published_at).not.toBeNull(); // batch didn't stall
    expect(afterSeen).toContain(`t.after.${tag}`);
  });

  it("dispatches under RLS: a handler's tenant read sees only its own org", async () => {
    await clearOutbox();
    const tag = randomUUID();
    const seenCounts: Record<string, number> = {};
    // The handler reads the outbox under its tenant tx; RLS must scope it to the dispatch org.
    const reader = handler(async (e, c) => {
      const rows = await c.tx.select().from(outbox);
      seenCounts[e.orgId] = rows.every((r) => r.orgId === e.orgId) ? rows.length : -1;
      return ok(undefined);
    });
    await seed(orgAId, `t.rls.${tag}`);
    await seed(orgBId, `t.rls.${tag}`);

    await runOutboxRelay(map([[`t.rls.${tag}`, reader]]));

    // -1 would mean the handler saw a foreign org's row (RLS breach). Both orgs must be >= 0.
    expect(seenCounts[orgAId]).toBeGreaterThanOrEqual(0);
    expect(seenCounts[orgBId]).toBeGreaterThanOrEqual(0);
  });

  it("runs the shipped InvoicePaidAuditHandler over a real invoice.paid event", async () => {
    await clearOutbox();
    const [r] = await seed(orgAId, "invoice.paid", { invoiceId: sentInvAId, leadId: leadAId });
    const summary = await runOutboxRelay(buildOutboxHandlers());
    expect(summary.published).toBeGreaterThanOrEqual(1);
    expect((await row(r!.id))[0]!.published_at).not.toBeNull(); // handler read the invoice under RLS, ok
  });

  it("loses no rows and does not deadlock under concurrent ticks (at-least-once)", async () => {
    // Contract is AT-LEAST-ONCE, not exactly-once: SKIP LOCKED only holds the row lock during the
    // claim statement, which auto-commits before the (network) dispatch — so an overlapping tick may
    // re-claim a not-yet-published row and dispatch it again. That is safe because handlers are
    // idempotent. What MUST hold: every row is eventually published (none lost/stuck) and concurrent
    // ticks don't deadlock. (A lease/single-flight upgrade to near-exactly-once is deferred.)
    await clearOutbox();
    const tag = randomUUID();
    const seen: string[] = [];
    const rec = handler(async (e) => {
      seen.push(e.id);
      return ok(undefined);
    });
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) ids.push((await seed(orgAId, `t.conc.${tag}`))[0]!.id);

    const handlers = map([[`t.conc.${tag}`, rec]]);
    await Promise.all([runOutboxRelay(handlers, { batch: 10 }), runOutboxRelay(handlers, { batch: 10 })]);

    const dispatched = new Set(seen.filter((id) => ids.includes(id)));
    expect(dispatched.size).toBe(ids.length); // every row dispatched at least once (none lost)
    for (const id of ids) expect((await row(id))[0]!.published_at).not.toBeNull(); // all published
  });
});
