import type { OrgId, Result, AppError, Clock, ValidationError } from "@mallet/shared/types";
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
 * Where a PO note's attachment is allowed to live — this order's own folder inside the private
 * `job-photos` bucket. Mirrors `leadNoteAttachmentPrefix(orgId, leadId)`
 * (modules/customers/domain/lead-note.ts); kept here rather than on the domain since
 * `PurchaseOrder` carries no note-attachment concept of its own to hang the check on.
 */
const poNoteAttachmentPrefix = (orgId: OrgId, poId: string): string => `${orgId}/purchase-orders/${poId}/`;

/**
 * A canonical mime: one slash, no spaces, both sides start with an alphanumeric. Same shape
 * `lead-note.ts`'s `MIME_SHAPE` enforces — without it a plain `z.string().min(1)` on the wire
 * would accept `"<script>"` as a file type and the note would persist with that "type" as a
 * permanent, unopenable value.
 */
const MIME_SHAPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i;

/**
 * The two checks `LeadNote.create()` runs on a customer note's attachment, ported for a PO note:
 * the path must sit under THIS order's own folder (derived from values the caller already
 * verified — orgId, and the poId the use-case just resolved a real order for — never from
 * anything asserted separately), and the type must look like a mime, not arbitrary text. Returns
 * `ok(undefined)` for "no attachment" so the caller can treat every path uniformly.
 */
const checkAttachment = (
  orgId: OrgId,
  poId: string,
  attachment: AddPurchaseOrderNoteAttachment | null | undefined,
): Result<void, ValidationError> => {
  if (!attachment) return ok(undefined);

  const prefix = poNoteAttachmentPrefix(orgId, poId);
  // `..` can never appear in a key the app mints, so its presence means the path was assembled
  // somewhere else. `path.length === prefix.length` catches a path that IS the folder with
  // nothing inside it.
  if (!attachment.path.startsWith(prefix) || attachment.path.length === prefix.length || attachment.path.includes("..")) {
    return err(validation("an attachment must be stored under this order's own folder", "attachmentPath"));
  }
  if (!MIME_SHAPE.test(attachment.type)) {
    return err(validation(`"${attachment.type}" is not a file type`, "attachmentType"));
  }
  return ok(undefined);
};

/**
 * A note is text OR a file — the same shape rule `purchase_order_notes_shape_check` enforces in
 * the DB (`length(trim(body)) > 0 or attachment_path is not null`). A photo of the counter receipt
 * needs no caption, so an attachment alone is a valid note; with no attachment, an empty note is a
 * blank line nobody meant to write.
 *
 * An attachment, when present, is checked against the SAME two rules `LeadNote.create()` checks
 * for a customer note: the path must sit under this order's own folder (derived from the PO this
 * use-case already loaded, never from anything the caller asserts separately), and the type must
 * look like a mime, not arbitrary text. Nothing downstream re-checks either — a row that persisted
 * with a foreign path or a fake type would stay permanently unopenable (indistinguishable from a
 * storage outage) or, worse, be the first place a future export/email/bulk-mover reads
 * `attachmentPath` without the (orgId, poId) context that keeps it safe today.
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

    const attachmentCheck = checkAttachment(orgId, cmd.poId, cmd.attachment);
    if (!attachmentCheck.ok) return attachmentCheck;

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
