import type { OrgId, Result, AppError, Clock } from "@mallet/shared/types";
import { ok, err, isOk, notFound, conflict } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import { PurchaseOrder } from "../domain/purchase-order";
import type { PurchaseOrderRepository } from "../domain/purchase-order-repository";

export interface UpdatePurchaseOrderLineInput {
  /** An existing line's id to update it in place; omitted mints a new line via IdGenerator. */
  readonly id?: string;
  readonly description: string;
  readonly qty: number;
  readonly uom: string;
  readonly unitCostMillicents: number;
}

export interface UpdatePurchaseOrderCommand {
  readonly poId: string;
  readonly vendor?: string;
  readonly jobId?: string | null;
  readonly expectedAt?: Date | null;
  readonly shipToAddress?: string | null;
  readonly orderedByUserId?: string | null;
  readonly freightCents?: number;
  readonly taxCents?: number;
  /** Full replace of the line set. Undefined leaves the existing lines untouched. */
  readonly lines?: readonly UpdatePurchaseOrderLineInput[];
}

/**
 * Edit a purchase order's header, and — draft only — its lines.
 *
 * Once an order is placed, its lines are what the vendor was told to send. Editing them here
 * would silently rewrite the record a vendor's bill later has to reconcile against, erasing
 * exactly the variance a bill is supposed to surface. Cancel and re-order instead; a note can
 * carry a correction without touching what was actually ordered.
 *
 * Header fields (freight quoted late, a corrected ship-to) stay editable after placing, since
 * none of them is a promise already made to the vendor. A cancelled order accepts no edits at
 * all — there is nothing left to correct.
 */
export class UpdatePurchaseOrderUseCase {
  constructor(
    private readonly repo: PurchaseOrderRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(orgId: OrgId, cmd: UpdatePurchaseOrderCommand): Promise<Result<PurchaseOrder, AppError>> {
    const po = await this.repo.findById(cmd.poId);
    if (!po || po.props.orgId !== orgId) return err(notFound("purchase order not found"));

    if (po.props.status === "cancelled") {
      return err(conflict("This order is cancelled — there is nothing left on it to edit.", "status"));
    }

    if (cmd.lines !== undefined && po.props.status !== "draft") {
      return err(
        conflict(
          "Reconciling a bill by editing what you ordered erases the variance — cancel and reorder instead.",
          "lines",
        ),
      );
    }

    const now = this.clock.now();
    const lines =
      cmd.lines === undefined
        ? po.props.lines
        : cmd.lines.map((l, i) => ({
            id: l.id ?? this.ids.newId(),
            description: l.description,
            qty: l.qty,
            uom: l.uom,
            unitCostMillicents: l.unitCostMillicents,
            position: i,
          }));

    const patched = PurchaseOrder.create({
      ...po.props,
      vendor: cmd.vendor ?? po.props.vendor,
      jobId: cmd.jobId === undefined ? po.props.jobId : cmd.jobId,
      expectedAt: cmd.expectedAt === undefined ? po.props.expectedAt : cmd.expectedAt,
      shipToAddress: cmd.shipToAddress === undefined ? po.props.shipToAddress : cmd.shipToAddress,
      orderedByUserId: cmd.orderedByUserId === undefined ? po.props.orderedByUserId : cmd.orderedByUserId,
      freightCents: cmd.freightCents ?? po.props.freightCents,
      taxCents: cmd.taxCents ?? po.props.taxCents,
      lines,
      updatedAt: now,
    });
    if (!isOk(patched)) return patched;

    await this.repo.save(patched.value);
    logger.info({ poId: patched.value.props.id, orgId }, "purchase_order.updated");
    return ok(patched.value);
  }
}
