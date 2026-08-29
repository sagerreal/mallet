import type { OrgId, Result, AppError, Clock } from "@mallet/shared/types";
import { ok, isOk } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import { PurchaseOrder, type ShipTo } from "../domain/purchase-order";
import type { PurchaseOrderRepository } from "../domain/purchase-order-repository";

export interface CreatePurchaseOrderLineInput {
  readonly description: string;
  readonly qty: number;
  readonly uom: string;
  readonly unitCostMillicents: number;
}

export interface CreatePurchaseOrderCommand {
  readonly id?: string; // client-authored id; a new one is minted when absent
  readonly vendor: string;
  readonly jobId: string | null;
  readonly expectedAt: Date | null;
  readonly shipTo: ShipTo;
  readonly orderedByUserId: string | null;
  readonly freightCents?: number;
  readonly taxCents?: number;
  readonly lines?: readonly CreatePurchaseOrderLineInput[];
}

/**
 * Always mints a DRAFT: no number (the `purchase_orders_num_check` constraint forbids one on a
 * draft) and no orderedAt. Placing — and allocating the PO-#### — is `PlacePurchaseOrderUseCase`'s
 * job alone; a draft can sit unplaced, or be abandoned, without ever touching the number sequence.
 */
export class CreatePurchaseOrderUseCase {
  constructor(
    private readonly repo: PurchaseOrderRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(orgId: OrgId, cmd: CreatePurchaseOrderCommand): Promise<Result<PurchaseOrder, AppError>> {
    const now = this.clock.now();
    const lines = (cmd.lines ?? []).map((l, i) => ({
      id: this.ids.newId(),
      description: l.description,
      qty: l.qty,
      uom: l.uom,
      unitCostMillicents: l.unitCostMillicents,
      position: i,
    }));

    const built = PurchaseOrder.create({
      id: cmd.id ?? this.ids.newId(),
      orgId,
      num: null,
      vendor: cmd.vendor,
      status: "draft",
      jobId: cmd.jobId,
      orderedAt: null,
      expectedAt: cmd.expectedAt,
      shipTo: cmd.shipTo,
      orderedByUserId: cmd.orderedByUserId,
      freightCents: cmd.freightCents ?? 0,
      taxCents: cmd.taxCents ?? 0,
      lines,
      createdAt: now,
      updatedAt: now,
    });
    if (!isOk(built)) return built;

    await this.repo.save(built.value);
    logger.info({ poId: built.value.props.id, orgId }, "purchase_order.created");
    return ok(built.value);
  }
}
