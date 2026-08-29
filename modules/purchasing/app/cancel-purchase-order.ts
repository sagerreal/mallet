import type { OrgId, Result, AppError } from "@mallet/shared/types";
import { ok, err, isOk, notFound } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { PurchaseOrder } from "../domain/purchase-order";
import type { PurchaseOrderRepository } from "../domain/purchase-order-repository";

/**
 * Ordered → cancelled. `PurchaseOrder.cancel()` itself refuses a draft ("delete it instead — the
 * vendor never heard of it") and an already-cancelled order; this use-case is the thin DI/repo
 * wrapper around that rule, not a second copy of it. Deleting an abandoned draft is a separate,
 * not-yet-built use-case and MUST soft-delete (`repo.softDelete`) — never this one's job, and
 * never a hard delete.
 */
export class CancelPurchaseOrderUseCase {
  constructor(private readonly repo: PurchaseOrderRepository) {}

  async exec(orgId: OrgId, poId: string): Promise<Result<PurchaseOrder, AppError>> {
    const po = await this.repo.findById(poId);
    if (!po || po.props.orgId !== orgId) return err(notFound("purchase order not found"));

    const cancelled = po.cancel();
    if (!isOk(cancelled)) return cancelled;

    await this.repo.save(cancelled.value);
    logger.info({ poId: cancelled.value.props.id, orgId }, "purchase_order.cancelled");
    return ok(cancelled.value);
  }
}
