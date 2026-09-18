import type { OrgId, Result, AppError, Clock } from "@mallet/shared/types";
import { ok, err, notFound, conflict } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { PurchaseOrderRepository } from "../domain/purchase-order-repository";

/**
 * Draft → gone. The one deletion path for a purchase order — SOFT (`repo.softDelete`), never a
 * hard delete, matching every other tenant table in this app.
 *
 * Draft-only, and that check is this use-case's whole job. `PurchaseOrder.cancel()` refuses to
 * cancel a draft ("delete it instead — the vendor never heard of it"); this is that refusal's
 * mirror image. A PLACED order carries a vendor-facing number and the vendor has heard of it, so
 * undoing it is CANCEL's job, not this one's — hence the "cancel it instead" refusal below reads
 * as the paired sentence to cancel()'s "delete it instead". The check lives here rather than in
 * the domain because there is no `PurchaseOrder` state transition for "does not exist any more"
 * to validate against — removal is the repository's concern, not a value the aggregate can hold.
 */
export class RemovePurchaseOrderUseCase {
  constructor(
    private readonly repo: PurchaseOrderRepository,
    private readonly clock: Clock,
  ) {}

  async exec(orgId: OrgId, poId: string): Promise<Result<{ removed: true }, AppError>> {
    const po = await this.repo.findById(poId);
    if (!po || po.props.orgId !== orgId) return err(notFound("purchase order not found"));

    if (po.props.status === "ordered") {
      return err(
        conflict(
          "Cancel this order rather than deleting it — the vendor has already heard of it and it carries a number.",
          "status",
        ),
      );
    }
    if (po.props.status === "cancelled") {
      return err(conflict("This order is already cancelled — there is nothing left to delete.", "status"));
    }

    const count = await this.repo.softDelete(poId, this.clock.now());
    if (count === 0) return err(notFound("purchase order not found"));

    logger.info({ poId, orgId }, "purchase_order.removed");
    return ok({ removed: true });
  }
}
