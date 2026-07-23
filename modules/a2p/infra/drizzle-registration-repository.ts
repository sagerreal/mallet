import { eq } from "drizzle-orm";
import { a2pRegistrations } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import type { A2pRegistration } from "../domain/registration";
import type { RegistrationRepository } from "../domain/registration-repository";
import { toDomain, toRow } from "./registration-mapper";

// Real persistence. Constructed with a tenant-scoped transaction (withTenant already set
// app.current_org_id), so RLS scopes every statement to this org. `save` upserts by orgId
// (the a2p_registrations_org_uidx unique index) — one registration per org.
export class DrizzleRegistrationRepository implements RegistrationRepository {
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
