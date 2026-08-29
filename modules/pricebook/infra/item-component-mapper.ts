import { pricebookItemComponents } from "@mallet/shared/db/schema";
import { ItemComponent } from "../domain/item-component";

export type ItemComponentRow = typeof pricebookItemComponents.$inferSelect;

/**
 * A stored row back into the domain. Corrupt data throws rather than silently coercing — the
 * same rule the service and estimate mappers follow, and for the same reason: a component
 * carries what a shop pays and what they charge, and a quietly-coerced one underquotes a job.
 */
export const rowToItemComponent = (row: ItemComponentRow): ItemComponent => {
  const result = ItemComponent.create({
    id: row.id,
    description: row.description,
    unit: row.unit,
    qtyExpr: row.qtyExpr,
    roundUp: row.roundUp,
    unitCostCents: row.unitCostCents,
    unitPriceCents: row.unitPriceCents,
    markupBps: row.markupBps,
    position: row.position,
  });
  if (!result.ok) {
    throw new Error(`corrupt pricebook_item_component ${row.id}: ${result.error.message}`);
  }
  return result.value;
};
