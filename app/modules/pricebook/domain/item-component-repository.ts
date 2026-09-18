import type { OrgId } from "@mallet/shared/types";
import type { ItemComponent } from "./item-component";

/**
 * The parts of saved assemblies. Owns `pricebook_item_components` and nothing else — the parent
 * row is a Service and stays with ServiceRepository, so one table has one writer.
 *
 * The org is NEVER a parameter: it is implicit in the org-scoped transaction the repository is
 * constructed with, so a caller physically cannot address another tenant's costing.
 */
export interface ItemComponentRepository {
  /**
   * Replace an item's components wholesale.
   *
   * Wholesale rather than a per-row diff because a saved assembly is one thing the office edits
   * as a unit: they change the posts, drop the gate hardware and add labour, then press Update.
   * A diff would have to guess which of those was a rename and which was a replacement, and
   * guessing wrong silently moves a cost.
   */
  replaceFor(itemId: string, components: readonly ItemComponent[], now: Date): Promise<void>;

  /** One item's components, in position order. Empty when the item is not an assembly. */
  listFor(itemId: string): Promise<ItemComponent[]>;

  /**
   * The components of many items at once, keyed by item id — one query for a whole page.
   * The pricebook list renders every entry, and a query per row is the N+1 this exists to avoid.
   */
  listForMany(itemIds: readonly string[]): Promise<Map<string, ItemComponent[]>>;
}

/** Constructed per request against an org-scoped transaction — see the note above. */
export type ItemComponentRepositoryFactory = (orgId: OrgId) => ItemComponentRepository;
