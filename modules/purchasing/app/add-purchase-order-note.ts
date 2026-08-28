import type { OrgId, Result, AppError, Clock } from "@mallet/shared/types";
import { ok, err, notFound, validation } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { PONoteRow, PurchaseOrderRepository } from "../domain/purchase-order-repository";

export interface AddPurchaseOrderNoteAttachment {
  readonly path: string;
  readonly name: string;
  readonly type: string;
}

export interface AddPurchaseOrderNoteCommand {
  readonly poId: string;
  readonly body: string;
  readonly authorUserId: string | null;
  readonly attachment?: AddPurchaseOrderNoteAttachment | null;
}

/**
 * A note is text OR a file — the same shape rule `purchase_order_notes_shape_check` enforces in
 * the DB (`length(trim(body)) > 0 or attachment_path is not null`). A photo of the counter receipt
 * needs no caption, so an attachment alone is a valid note; with no attachment, an empty note is a
 * blank line nobody meant to write.
 */
export class AddPurchaseOrderNoteUseCase {
  constructor(
    private readonly repo: PurchaseOrderRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(orgId: OrgId, cmd: AddPurchaseOrderNoteCommand): Promise<Result<PONoteRow, AppError>> {
    const po = await this.repo.findById(cmd.poId);
    if (!po || po.props.orgId !== orgId) return err(notFound("purchase order not found"));

    const body = cmd.body.trim();
    if (!body && !cmd.attachment) {
      return err(validation("A note needs some words or an attachment.", "body"));
    }

    const note: PONoteRow & { poId: string } = {
      id: this.ids.newId(),
      poId: cmd.poId,
      body,
      authorUserId: cmd.authorUserId,
      attachmentPath: cmd.attachment?.path ?? null,
      attachmentName: cmd.attachment?.name ?? null,
      attachmentType: cmd.attachment?.type ?? null,
      createdAt: this.clock.now(),
    };

    await this.repo.addNote(note);
    logger.info({ poId: cmd.poId, orgId }, "purchase_order.note.added");
    return ok(note);
  }
}
