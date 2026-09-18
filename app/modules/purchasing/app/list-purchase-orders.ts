import type { PurchaseOrder } from "../domain/purchase-order";
import type { PurchaseOrderRepository } from "../domain/purchase-order-repository";

/**
 * Thin read use-case: tenant scoping is enforced by the org-scoped transaction the repository
 * runs in (mirrors `ListCompaniesUseCase` / `ListInvoicesUseCase`, both of which take no orgId
 * either). Ordering — newest first — is the repository's job:
 * `DrizzlePurchaseOrderRepository.list()` orders by `(createdAt desc, id desc)` to match the
 * `purchase_orders_org_created_idx` index, and `FakePurchaseOrderRepository.list()` mirrors it so
 * the same expectation holds under both.
 */
export class ListPurchaseOrdersUseCase {
  constructor(private readonly repo: PurchaseOrderRepository) {}

  exec(): Promise<readonly PurchaseOrder[]> {
    return this.repo.list();
  }
}
