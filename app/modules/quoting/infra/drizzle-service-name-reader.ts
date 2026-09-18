import { and, eq, isNull } from "drizzle-orm";
import { pricebookItems } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { asServiceId, type OrgId } from "@mallet/shared/types";
import type { ServiceNameEntry, ServiceNameReader } from "../domain/service-name-reader";

// Per-org catalogs are small (hundreds, not thousands) — a flat cap beats
// cursor plumbing for a name-anchor lookup.
const NAME_CAP = 500;

// Real persistence. Constructed with a tenant-scoped tx (RLS applies); the
// explicit eq(orgId) filter is the house defense-in-depth rule and keeps the
// org-prefixed index usable.
export class DrizzleServiceNameReader implements ServiceNameReader {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async listActiveNames(): Promise<ServiceNameEntry[]> {
    const rows = await this.tx
      .select({ id: pricebookItems.id, label: pricebookItems.label })
      .from(pricebookItems)
      .where(
        and(
          eq(pricebookItems.orgId, this.orgId),
          eq(pricebookItems.active, true),
          isNull(pricebookItems.deletedAt),
        ),
      )
      .limit(NAME_CAP);
    return rows.map((r) => ({ id: asServiceId(r.id), name: r.label }));
  }
}
