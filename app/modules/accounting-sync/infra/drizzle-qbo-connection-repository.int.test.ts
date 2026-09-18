import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomBytes } from "node:crypto";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { asOrgId, type OrgId } from "@mallet/shared/types";
import { createSecretBox } from "@mallet/platform/crypto/secret-box";
import { QboConnection, type QboConnectionProps } from "../domain/qbo-connection";
import { DrizzleQboConnectionRepository } from "./drizzle-qbo-connection-repository";

// Skipped when DB credentials are absent (see vitest.int.setup.ts for env loading).
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const T0 = new Date("2026-07-24T12:00:00.000Z");
const mins = (n: number) => n * 60_000;
const days = (n: number) => n * 24 * 60 * 60_000;

const box = (() => {
  const res = createSecretBox(randomBytes(32).toString("base64"));
  if (!res.ok) throw new Error("fixture key rejected");
  return res.value;
})();

suite("DrizzleQboConnectionRepository (live RLS)", () => {
  let admin: Sql;
  let orgId = "";
  let otherOrgId = "";

  const props = (org: string, over: Partial<QboConnectionProps> = {}): QboConnectionProps => ({
    id: crypto.randomUUID(),
    orgId: org,
    realmId: "9130350000000000",
    accessTokenSealed: box.seal("ACCESS-1"),
    refreshTokenSealed: box.seal("REFRESH-1"),
    accessExpiresAt: new Date(T0.getTime() + mins(60)),
    refreshExpiresAt: new Date(T0.getTime() + days(100)),
    status: "active",
    connectedByUserId: null,
    lastSyncAt: null,
    defaultItemQboId: null,
    defaultItemName: null,
    sendApprovedHours: false,
    defaultInvoiceItemQboId: null,
    defaultInvoiceItemName: null,
    sendInvoices: false,
    createdAt: T0,
    updatedAt: T0,
    disconnectedAt: null,
    ...over,
  });

  const connection = (org: string, over: Partial<QboConnectionProps> = {}): QboConnection => {
    const res = QboConnection.create(props(org, over));
    if (!res.ok) throw new Error(`fixture rejected: ${res.error.message}`);
    return res.value;
  };

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 2, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('QboConnRepo ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('QboConnRepo other ' || gen_random_uuid()) returning id`;
    orgId = a!.id;
    otherOrgId = b!.id;
  });

  afterAll(async () => {
    for (const id of [orgId, otherOrgId].filter(Boolean)) {
      await admin`delete from qbo_connections where org_id = ${id}`;
      await admin`delete from orgs where id = ${id}`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("saves and reads back a connection for the tenant", async () => {
    const ORG: OrgId = asOrgId(orgId);
    await withTenant(ORG, async (tx) => {
      const repo = new DrizzleQboConnectionRepository(tx, ORG);
      await repo.save(connection(orgId));

      const got = await repo.get();
      expect(got?.props.realmId).toBe("9130350000000000");
      expect(got?.props.status).toBe("active");
    });
  });

  it("round-trips sealed tokens through Postgres byte-for-byte", async () => {
    const ORG: OrgId = asOrgId(orgId);
    await withTenant(ORG, async (tx) => {
      const repo = new DrizzleQboConnectionRepository(tx, ORG);
      const sealed = box.seal("a-refresh-token-with-+/=-base64-chars");
      await repo.save(connection(orgId, { refreshTokenSealed: sealed }));

      const got = await repo.get();
      expect(got?.props.refreshTokenSealed).toBe(sealed);
      const opened = box.open(got?.props.refreshTokenSealed as string);
      expect(opened.ok).toBe(true);
      if (opened.ok) expect(opened.value).toBe("a-refresh-token-with-+/=-base64-chars");
    });
  });

  it("upserts on org_id — a reconnect updates in place rather than stacking rows", async () => {
    const ORG: OrgId = asOrgId(orgId);
    await withTenant(ORG, async (tx) => {
      const repo = new DrizzleQboConnectionRepository(tx, ORG);
      await repo.save(connection(orgId, { realmId: "first" }));
      await repo.save(connection(orgId, { realmId: "second" }));

      const got = await repo.get();
      expect(got?.props.realmId).toBe("second");
    });

    const rows = await admin`select count(*)::int as n from qbo_connections where org_id = ${orgId}`;
    expect((rows[0] as { n: number }).n).toBe(1);
  });

  it("persists a disconnect (empty tokens, status disconnected)", async () => {
    const ORG: OrgId = asOrgId(orgId);
    await withTenant(ORG, async (tx) => {
      const repo = new DrizzleQboConnectionRepository(tx, ORG);
      await repo.save(connection(orgId));
      await repo.save((await repo.get())!.disconnect(T0));

      const got = await repo.get();
      expect(got?.props.status).toBe("disconnected");
      expect(got?.props.refreshTokenSealed).toBe("");
    });
  });

  it("getForUpdate returns the row (and takes a lock) inside a tenant tx", async () => {
    const ORG: OrgId = asOrgId(orgId);
    await withTenant(ORG, async (tx) => {
      const repo = new DrizzleQboConnectionRepository(tx, ORG);
      await repo.save(connection(orgId));

      const locked = await repo.getForUpdate();
      expect(locked?.props.orgId).toBe(orgId);
    });
  });

  // The point of the whole RLS apparatus: one shop must never see another's QuickBooks tokens.
  it("does NOT leak another org's connection", async () => {
    await withTenant(asOrgId(otherOrgId), async (tx) => {
      const repo = new DrizzleQboConnectionRepository(tx, asOrgId(otherOrgId));
      await repo.save(connection(otherOrgId, { realmId: "other-realm" }));
    });

    await withTenant(asOrgId(orgId), async (tx) => {
      const repo = new DrizzleQboConnectionRepository(tx, asOrgId(orgId));
      const got = await repo.get();
      expect(got?.props.realmId).not.toBe("other-realm");
    });
  });

  it("rejects writing a row for a different org (RLS WITH CHECK)", async () => {
    await expect(
      withTenant(asOrgId(orgId), async (tx) => {
        const repo = new DrizzleQboConnectionRepository(tx, asOrgId(orgId));
        // Same repo/session, but a domain object belonging to the OTHER org.
        await repo.save(connection(otherOrgId, { realmId: "smuggled" }));
      }),
    ).rejects.toThrow();
  });
});
