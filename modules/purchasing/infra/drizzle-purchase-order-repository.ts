import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { purchaseOrders, purchaseOrderLines, purchaseOrderNotes } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import type { PurchaseOrder, POLineProps } from "../domain/purchase-order";
import type { PurchaseOrderRepository, PONoteRow } from "../domain/purchase-order-repository";
import { toDomain, fromDate, type PORow } from "./purchase-order-mapper";

// Real persistence. Constructed with a tenant-scoped tx, so RLS already scopes every statement —
// and every read/write ALSO filters `org_id = this.orgId` explicitly, the same belt-and-braces
// the invoice and jobs repositories use. Two independent lines of defense, because a single
// missing `withTenant` (or a hand-edited policy on the live DB) would otherwise be the only thing
// standing between one shop's purchasing and another's.
export class DrizzlePurchaseOrderRepository implements PurchaseOrderRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  /** Allocates the next PO-#### for this org. Copies DrizzleInvoiceRepository.nextNumber verbatim. */
  async nextNumber(): Promise<string> {
    await this.tx.execute(sql`
      insert into number_sequences (org_id, kind) values (${this.orgId}, 'po')
      on conflict (org_id, kind) do nothing
    `);
    const rows = (await this.tx.execute(sql`
      update number_sequences set next_val = next_val + 1, updated_at = now()
      where org_id = ${this.orgId} and kind = 'po'
      returning next_val - 1 as allocated
    `)) as unknown as { allocated: number }[];
    return `PO-${rows[0]?.allocated ?? 1000}`;
  }

  async list(): Promise<readonly PurchaseOrder[]> {
    const headers = await this.tx
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.orgId, this.orgId), isNull(purchaseOrders.deletedAt)))
      .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.id));
    return Promise.all(headers.map((header) => this.hydrate(header)));
  }

  async findById(id: string): Promise<PurchaseOrder | null> {
    const rows = await this.tx
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.orgId, this.orgId), eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)))
      .limit(1);
    const header = rows[0];
    return header ? this.hydrate(header) : null;
  }

  async save(po: PurchaseOrder): Promise<void> {
    const p = po.props;
    const columns = {
      num: p.num,
      vendor: p.vendor,
      status: p.status,
      jobId: p.jobId,
      orderedAt: fromDate(p.orderedAt),
      expectedAt: fromDate(p.expectedAt),
      shipTo: p.shipTo,
      orderedByUserId: p.orderedByUserId,
      freightCents: p.freightCents,
      taxCents: p.taxCents,
      updatedAt: p.updatedAt,
    };
    await this.tx
      .insert(purchaseOrders)
      .values({ id: p.id, orgId: p.orgId, createdAt: p.createdAt, ...columns })
      .onConflictDoUpdate({ target: purchaseOrders.id, set: columns });
    await this.replaceLines(p.id, p.orgId, p.lines);
  }

  async softDelete(id: string, now: Date): Promise<number> {
    const rows = await this.tx
      .update(purchaseOrders)
      .set({ deletedAt: now })
      .where(and(eq(purchaseOrders.orgId, this.orgId), eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)))
      .returning({ id: purchaseOrders.id });
    return rows.length;
  }

  async listNotes(poId: string): Promise<readonly PONoteRow[]> {
    const rows = await this.tx
      .select()
      .from(purchaseOrderNotes)
      .where(
        and(
          eq(purchaseOrderNotes.orgId, this.orgId),
          eq(purchaseOrderNotes.poId, poId),
          isNull(purchaseOrderNotes.deletedAt),
        ),
      )
      .orderBy(desc(purchaseOrderNotes.createdAt));
    return rows.map((r) => ({
      id: r.id,
      body: r.body,
      authorUserId: r.authorUserId,
      attachmentPath: r.attachmentPath,
      attachmentName: r.attachmentName,
      createdAt: r.createdAt,
    }));
  }

  async addNote(note: PONoteRow & { poId: string }): Promise<void> {
    await this.tx.insert(purchaseOrderNotes).values({
      id: note.id,
      orgId: this.orgId,
      poId: note.poId,
      body: note.body,
      authorUserId: note.authorUserId,
      attachmentPath: note.attachmentPath,
      attachmentName: note.attachmentName,
      createdAt: note.createdAt,
    });
  }

  // --- helpers ---

  private async hydrate(header: PORow): Promise<PurchaseOrder> {
    const lineRows = await this.tx
      .select()
      .from(purchaseOrderLines)
      .where(and(eq(purchaseOrderLines.orgId, this.orgId), eq(purchaseOrderLines.poId, header.id)));
    return toDomain(header, lineRows);
  }

  /**
   * DELETE-then-INSERT the lines, inside the caller's transaction. `purchase_order_lines` has no
   * `deleted_at` — there is no soft-delete tier below the order itself — so an upsert-by-id would
   * leave a line removed in memory still sitting on the row forever. This is what pins that: hard
   * delete every existing line for the order, then insert exactly the set the aggregate carries.
   */
  private async replaceLines(poId: string, orgId: OrgId, lines: readonly POLineProps[]): Promise<void> {
    await this.tx
      .delete(purchaseOrderLines)
      .where(and(eq(purchaseOrderLines.orgId, orgId), eq(purchaseOrderLines.poId, poId)));
    if (lines.length === 0) return;
    await this.tx.insert(purchaseOrderLines).values(
      lines.map((l) => ({
        id: l.id,
        orgId,
        poId,
        description: l.description,
        qty: String(l.qty),
        uom: l.uom,
        unitCostMillicents: l.unitCostMillicents,
        position: l.position,
      })),
    );
  }
}
