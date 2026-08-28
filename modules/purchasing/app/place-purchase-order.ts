import type { OrgId, Result, AppError, Clock } from "@mallet/shared/types";
import { ok, err, isOk, notFound } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { PurchaseOrder } from "../domain/purchase-order";
import type { PurchaseOrderRepository } from "../domain/purchase-order-repository";

// A number that never leaves this function. `place()` needs SOME truthy string to satisfy the
// `(status = 'draft') = (num is null)` invariant it validates internally — but the real PO-#### is
// only worth allocating once we already know place() will succeed. See the class doc for why.
const DRY_RUN_NUM = "DRY-RUN";

export class PlacePurchaseOrderUseCase {
  constructor(
    private readonly repo: PurchaseOrderRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * Draft → ordered. Allocates the PO-#### ONLY after `place()` has validated (status is draft,
   * at least one line) — a rejected place must burn no number, because `nextNumber()` hands out a
   * GAPLESS sequence somebody reads aloud to a vendor's branch. Calling `place()` twice (once with
   * a throwaway number to prove it will succeed, once for real) keeps that ordering without
   * duplicating place()'s own validation rules here.
   */
  async exec(orgId: OrgId, poId: string): Promise<Result<PurchaseOrder, AppError>> {
    const po = await this.repo.findById(poId);
    if (!po || po.props.orgId !== orgId) return err(notFound("purchase order not found"));

    const now = this.clock.now();

    const dryRun = po.place(DRY_RUN_NUM, now);
    if (!isOk(dryRun)) return dryRun;

    const num = await this.repo.nextNumber();
    const placed = po.place(num, now);
    if (!isOk(placed)) return placed; // unreachable given the dry run above; kept for safety

    await this.repo.save(placed.value);
    logger.info({ poId: placed.value.props.id, orgId, num }, "purchase_order.placed");
    return ok(placed.value);
  }
}
