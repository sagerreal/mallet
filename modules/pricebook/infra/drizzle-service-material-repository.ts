import { and, eq, inArray } from "drizzle-orm";
import { pricebookServiceMaterials } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { asMaterialId, asOrgId, asServiceId, type MaterialId, type OrgId, type ServiceId } from "@mallet/shared/types";
import { ServiceMaterial } from "../domain/service-material";
import type { ServiceMaterialRepository } from "../domain/service-material";

type ServiceMaterialRow = typeof pricebookServiceMaterials.$inferSelect;

// Reconstruct a domain ServiceMaterial from a DB row. Corrupt data throws rather than silently
// coercing (mirrors material-mapper's / service-mapper's rowToX precedent). `quantity` is
// `numeric(8,2)` — Drizzle (no `mode: "number"`) returns it as a string; convert at this
// read boundary only.
const rowToServiceMaterial = (row: ServiceMaterialRow): ServiceMaterial => {
  const result = ServiceMaterial.create({
    orgId: asOrgId(row.orgId),
    serviceId: asServiceId(row.serviceId),
    materialId: asMaterialId(row.materialId),
    quantity: Number(row.quantity),
  });
  if (!result.ok) {
    throw new Error(
      `corrupt pricebook_service_material ${row.serviceId}/${row.materialId}: ${result.error.message}`,
    );
  }
  return result.value;
};

// Real persistence for the service↔material join. Constructed with a tenant-scoped transaction
// (withTenant already set app.current_org_id), so RLS appends `org_id = current_org_id()` to
// every statement. orgId is supplied only to stamp inserted rows and guard explicit-tenant
// writes.
export class DrizzleServiceMaterialRepository implements ServiceMaterialRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async attach(input: {
    orgId: string;
    serviceId: ServiceId;
    materialId: MaterialId;
    quantity: number;
  }): Promise<void> {
    // Upsert on the (service_id, material_id) primary key — attaching an already-attached
    // material updates its quantity rather than erroring.
    await this.tx
      .insert(pricebookServiceMaterials)
      .values({
        orgId: this.orgId,
        serviceId: input.serviceId,
        materialId: input.materialId,
        quantity: String(input.quantity),
      })
      .onConflictDoUpdate({
        target: [pricebookServiceMaterials.serviceId, pricebookServiceMaterials.materialId],
        set: { quantity: String(input.quantity) },
      });
  }

  async detach(serviceId: ServiceId, materialId: MaterialId): Promise<number> {
    const rows = await this.tx
      .delete(pricebookServiceMaterials)
      .where(
        and(
          eq(pricebookServiceMaterials.orgId, this.orgId),
          eq(pricebookServiceMaterials.serviceId, serviceId),
          eq(pricebookServiceMaterials.materialId, materialId),
        ),
      )
      .returning();
    return rows.length;
  }

  async listForService(serviceId: ServiceId): Promise<ServiceMaterial[]> {
    const rows = await this.tx
      .select()
      .from(pricebookServiceMaterials)
      .where(
        and(
          eq(pricebookServiceMaterials.orgId, this.orgId),
          eq(pricebookServiceMaterials.serviceId, serviceId),
        ),
      );
    return rows.map(rowToServiceMaterial);
  }

  async listForServices(serviceIds: string[]): Promise<ServiceMaterial[]> {
    // Avoid an `IN ()` error and skip the round-trip entirely when there is nothing to load.
    if (serviceIds.length === 0) return [];

    // ONE query for every service — avoids N+1 when hydrating a page of services.
    const rows = await this.tx
      .select()
      .from(pricebookServiceMaterials)
      .where(
        and(
          eq(pricebookServiceMaterials.orgId, this.orgId),
          inArray(pricebookServiceMaterials.serviceId, serviceIds),
        ),
      );
    return rows.map(rowToServiceMaterial);
  }
}
