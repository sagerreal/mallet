import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import {
  asOrgId,
  toPage,
  isOk,
  type OrgId,
} from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { Notification, type RelatedType } from "../domain/notification";
import { DrizzleNotificationRepository } from "./drizzle-notification-repository";

const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

interface NotifOpts {
  relatedType?: RelatedType;
  relatedId?: string;
  key?: string;
  stage?: number | null;
}

const build = (orgId: OrgId, o: NotifOpts = {}): Notification => {
  const r = Notification.create({
    id: randomUUID(),
    orgId,
    channel: "sms",
    to: "+15551234567",
    kind: o.stage != null ? "invoice_reminder" : "invoice_sent",
    body: "Invoice INV-1 is ready.",
    status: "queued",
    relatedType: o.relatedType ?? null,
    relatedId: o.relatedId ?? null,
    reminderStage: o.stage ?? null,
    idempotencyKey: o.key ?? `manual:${randomUUID()}`,
    externalId: null,
    error: null,
    sentAt: null,
    createdAt: new Date("2026-06-01T00:00:00Z"),
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

suite("DrizzleNotificationRepository against live Supabase RLS", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let invAId = "";
  let invBId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('NotifT A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('NotifT B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    const [la] = await admin<{ id: string }[]>`insert into leads (org_id, name) values (${orgAId}, 'Lead A') returning id`;
    const [lb] = await admin<{ id: string }[]>`insert into leads (org_id, name) values (${orgBId}, 'Lead B') returning id`;
    const [ia] = await admin<{ id: string }[]>`insert into invoices (org_id, num, lead_id, status) values (${orgAId}, 'INV-A1', ${la!.id}, 'sent') returning id`;
    const [ib] = await admin<{ id: string }[]>`insert into invoices (org_id, num, lead_id, status) values (${orgBId}, 'INV-B1', ${lb!.id}, 'sent') returning id`;
    invAId = ia!.id;
    invBId = ib!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("insert is idempotent on (org_id, idempotency_key)", async () => {
    const orgA = asOrgId(orgAId);
    const out = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleNotificationRepository(tx, orgA);
      const key = `idem-${randomUUID()}`;
      const first = await repo.insert(build(orgA, { relatedType: "invoice", relatedId: invAId, key }));
      const second = await repo.insert(build(orgA, { relatedType: "invoice", relatedId: invAId, key }));
      return { first, second };
    });
    expect(out.first).toBe(true);
    expect(out.second).toBe(false);
  });

  it("insert idempotency holds under CONCURRENT calls (exactly one applies)", async () => {
    const orgA = asOrgId(orgAId);
    const key = `idem-concurrent-${randomUUID()}`;
    const insert = () =>
      withTenant(orgA, (tx) =>
        new DrizzleNotificationRepository(tx, orgA).insert(build(orgA, { relatedType: "invoice", relatedId: invAId, key })),
      );
    const [a, b] = await Promise.all([insert(), insert()]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("markSent transitions a queued row and findByIdempotencyKey returns it", async () => {
    const orgA = asOrgId(orgAId);
    const out = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleNotificationRepository(tx, orgA);
      const key = `sent-${randomUUID()}`;
      const n = build(orgA, { relatedType: "invoice", relatedId: invAId, key });
      await repo.insert(n);
      const sent = await repo.markSent(n.props.id, "ext-1", new Date("2026-06-05T00:00:00Z"));
      const byKey = await repo.findByIdempotencyKey(key);
      return { status: sent?.props.status, byKeyId: byKey?.props.id, expected: n.props.id };
    });
    expect(out.status).toBe("sent");
    expect(out.byKeyId).toBe(out.expected);
  });

  it("sentReminderStages batches which stages were sent per target", async () => {
    const orgA = asOrgId(orgAId);
    const out = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleNotificationRepository(tx, orgA);
      await repo.insert(build(orgA, { relatedType: "invoice", relatedId: invAId, key: `reminder:${invAId}:1`, stage: 1 }));
      const map = await repo.sentReminderStages("invoice", [invAId]);
      return map.get(invAId) ?? [];
    });
    expect(out).toContain(1);
  });

  it("cannot see another org's notification (cross-tenant)", async () => {
    const orgA = asOrgId(orgAId);
    const notifId = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleNotificationRepository(tx, orgA);
      const n = build(orgA, { relatedType: "invoice", relatedId: invAId });
      await repo.insert(n);
      return n.props.id;
    });
    const orgB = asOrgId(orgBId);
    const seen = await withTenant(orgB, async (tx) => {
      const repo = new DrizzleNotificationRepository(tx, orgB);
      const byId = await repo.findById(notifId);
      const listed = await repo.list(toPage({ limit: 100 }));
      return { byId, ids: listed.items.map((n) => n.props.id) };
    });
    expect(seen.byId).toBeNull();
    expect(seen.ids).not.toContain(notifId);
  });

  it("composite FK rejects a notification referencing another org's invoice", async () => {
    const orgA = asOrgId(orgAId);
    const rejected = await withTenant(orgA, async (tx) => {
      await new DrizzleNotificationRepository(tx, orgA).insert(
        build(orgA, { relatedType: "invoice", relatedId: invBId }),
      );
    }).then(
      () => false,
      () => true,
    );
    expect(rejected).toBe(true);
  });
});
