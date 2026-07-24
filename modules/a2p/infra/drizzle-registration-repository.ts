import { eq, or } from "drizzle-orm";
import { a2pRegistrations } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { ownerDb } from "@mallet/shared/db/owner-client";
import type { OrgId } from "@mallet/shared/types";
import { asOrgId } from "@mallet/shared/types";
import type { A2pRegistration } from "../domain/registration";
import type { RegistrationRepository, OrgBySidReader } from "../domain/registration-repository";
import { toDomain, toRow } from "./registration-mapper";

// Real persistence. Constructed with a tenant-scoped transaction (withTenant already set
// app.current_org_id), so RLS scopes every statement to this org. `save` upserts by orgId
// (the a2p_registrations_org_uidx unique index) — one registration per org.
export class DrizzleRegistrationRepository implements RegistrationRepository {
  // `orgId` is intentionally unread here: `get()` filters on its method parameter and `save()`'s
  // upsert relies on `FORCE ROW LEVEL SECURITY` + `WITH CHECK (org_id = current_org_id())` rather
  // than an explicit `eq(orgId)` — safe under that enforcement, and matches the same
  // constructor-signature parity already present on sibling repos (e.g.
  // DrizzleNotificationRepository also carries an unread `orgId` field).
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async get(orgId: string): Promise<A2pRegistration | null> {
    const [row] = await this.tx.select().from(a2pRegistrations).where(eq(a2pRegistrations.orgId, orgId)).limit(1);
    return row ? toDomain(row) : null;
  }

  async save(reg: A2pRegistration): Promise<void> {
    const row = toRow(reg);
    await this.tx
      .insert(a2pRegistrations)
      .values(row)
      .onConflictDoUpdate({ target: a2pRegistrations.orgId, set: row });
  }
}

// Privileged reader — NOT org-scoped (no RLS session exists yet). The Twilio A2P status-callback
// webhook (Task 11) arrives with no principal; it needs to resolve which org owns the Twilio
// resource SID in the callback before it can open a tenant session. Uses ownerDb (the `postgres`
// BYPASSRLS role) for the same reason `DrizzleOrgByNumberReader` (messaging module) does — the
// normal RLS-scoped client would see current_org_id()=NULL and return zero rows, silently
// dropping every status callback. Returns only the OrgId, never row data (no SIDs, no
// business_info PII), minimising the surface area of the privileged path.
export class DrizzleOrgBySidReader implements OrgBySidReader {
  async findOrgIdBySid(sid: string): Promise<OrgId | null> {
    const rows = await ownerDb
      .select({ orgId: a2pRegistrations.orgId })
      .from(a2pRegistrations)
      .where(
        or(
          eq(a2pRegistrations.secondaryProfileSid, sid),
          eq(a2pRegistrations.brandSid, sid),
          eq(a2pRegistrations.campaignSid, sid),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? asOrgId(row.orgId) : null;
  }
}
