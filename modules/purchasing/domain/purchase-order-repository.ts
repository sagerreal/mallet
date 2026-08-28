import type { PurchaseOrder } from "./purchase-order";

export interface PONoteRow {
  readonly id: string;
  readonly body: string;
  readonly authorUserId: string | null;
  readonly attachmentPath: string | null;
  readonly attachmentName: string | null;
  readonly createdAt: Date;
}

export interface PurchaseOrderRepository {
  list(): Promise<readonly PurchaseOrder[]>;
  findById(id: string): Promise<PurchaseOrder | null>;
  save(po: PurchaseOrder): Promise<void>;
  softDelete(id: string, now: Date): Promise<number>;
  /** Allocates the next PO-#### for this org, inside the caller's transaction. */
  nextNumber(): Promise<string>;
  listNotes(poId: string): Promise<readonly PONoteRow[]>;
  addNote(note: PONoteRow & { poId: string }): Promise<void>;
}
