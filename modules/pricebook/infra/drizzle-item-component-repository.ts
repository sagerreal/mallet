import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { pricebookItemComponents } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import type { ItemComponent } from "../domain/item-component";
import type { ItemComponentRepository } from "../domain/item-component-repository";
import { rowToItemComponent } from "./item-component-mapper";

// Real persistence. Constructed with a tenant-scoped transaction (withTenant already set
// app.current_org_id), so RLS appends `org_id = current_org_id()` to every statement.
// orgId is supplied only to stamp inserted rows and guard explicit-tenant writes.
export class DrizzleItemComponentRepository implements ItemComponentRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async replaceFor(
    itemId: string,
    components: readonly ItemComponent[],
    now: Date,
  ): Promise<void> {
    // Retire first, then write. The other order would soft-delete the rows just inserted.
    await this.tx
      .update(pricebookItemComponents)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(pricebookItemComponents.itemId, itemId),
          eq(pricebookItemComponents.orgId, this.orgId),
          isNull(pricebookItemComponents.deletedAt),
        ),
      );
    if (components.length === 0) return;
    await this.tx.insert(pricebookItemComponents).values(
      components.map((component) => {
        const p = component.props;
        return {
          id: p.id,
          orgId: this.orgId,
          itemId,
          description: p.description,
          unit: p.unit,
          qtyExpr: p.qtyExpr,
          roundUp: p.roundUp,
          unitCostCents: p.unitCostCents,
          unitPriceCents: p.unitPriceCents,
          markupBps: p.markupBps,
          position: p.position,
          createdAt: now,
          updatedAt: now,
        };
      }),
    );
  }

  async listFor(itemId: string): Promise<ItemComponent[]> {
    const rows = await this.tx
      .select()
      .from(pricebookItemComponents)
      .where(
        and(
          eq(pricebookItemComponents.itemId, itemId),
          eq(pricebookItemComponents.orgId, this.orgId),
          isNull(pricebookItemComponents.deletedAt),
        ),
      )
      .orderBy(asc(pricebookItemComponents.position));
    return rows.map(rowToItemComponent);
  }

  async listForMany(itemIds: readonly string[]): Promise<Map<string, ItemComponent[]>> {
    const byItem = new Map<string, ItemComponent[]>();
    if (itemIds.length === 0) return byItem;
    const rows = await this.tx
      .select()
      .from(pricebookItemComponents)
      .where(
        and(
          inArray(pricebookItemComponents.itemId, [...itemIds]),
          eq(pricebookItemComponents.orgId, this.orgId),
          isNull(pricebookItemComponents.deletedAt),
        ),
      )
      .orderBy(asc(pricebookItemComponents.position));
    for (const row of rows) {
      const bucket = byItem.get(row.itemId) ?? [];
      bucket.push(rowToItemComponent(row));
      byItem.set(row.itemId, bucket);
    }
    return byItem;
  }
}
