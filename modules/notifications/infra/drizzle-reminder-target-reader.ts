import { and, desc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { invoices, estimates, leads } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { keysetBefore } from "@mallet/shared/db/keyset";
import {
  buildPage,
  decodeCursor,
  isOk,
  type OrgId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import type { RelatedType } from "../domain/notification";
import type { ReminderTarget, ReminderTargetReader } from "../domain/reminder-target-reader";

const OPEN_INVOICE_STATUSES = ["sent", "partial"] as const;

// Reads reminder targets straight from the invoices/estimates tables joined to their lead's
// contact (shared schema, RLS-scoped) — so notifications stays decoupled from the invoicing/quoting
// modules while still reaching the data a reminder needs.
export class DrizzleReminderTargetReader implements ReminderTargetReader {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async findTarget(type: RelatedType, id: string): Promise<ReminderTarget | null> {
    return type === "invoice" ? this.findInvoiceTarget(id) : this.findEstimateTarget(id);
  }

  private async findInvoiceTarget(id: string): Promise<ReminderTarget | null> {
    const rows = await this.tx
      .select({ inv: invoices, phone: leads.phoneE164, email: leads.email })
      .from(invoices)
      .innerJoin(leads, and(eq(leads.orgId, invoices.orgId), eq(leads.id, invoices.leadId)))
      .where(and(eq(invoices.id, id), isNull(invoices.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.toInvoiceTarget(row.inv, row.phone, row.email);
  }

  private toInvoiceTarget(
    inv: typeof invoices.$inferSelect,
    phone: string | null,
    email: string | null,
  ): ReminderTarget {
    return {
      type: "invoice",
      id: inv.id,
      num: inv.num,
      status: inv.status,
      sentAt: inv.sentAt,
      phone,
      email,
      balanceCents: Math.max(0, inv.totalCents - inv.depositPaidCents - inv.amountPaidCents),
      createdAt: inv.createdAt,
    };
  }

  private async findEstimateTarget(id: string): Promise<ReminderTarget | null> {
    const rows = await this.tx
      .select({ est: estimates, phone: leads.phoneE164, email: leads.email })
      .from(estimates)
      .innerJoin(leads, and(eq(leads.orgId, estimates.orgId), eq(leads.id, estimates.leadId)))
      .where(and(eq(estimates.id, id), isNull(estimates.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      type: "estimate",
      id: row.est.id,
      num: row.est.num,
      status: row.est.status,
      sentAt: row.est.sentAt,
      phone: row.phone,
      email: row.email,
      balanceCents: 0,
      createdAt: row.est.createdAt,
    };
  }

  async findOpenInvoiceTargets(page: CursorPage): Promise<Paginated<ReminderTarget>> {
    const conds: SQL[] = [
      isNull(invoices.deletedAt),
      inArray(invoices.status, [...OPEN_INVOICE_STATUSES]),
    ];
    if (page.cursor) {
      const cursor = decodeCursor(page.cursor);
      if (isOk(cursor)) {
        conds.push(keysetBefore(invoices.createdAt, invoices.id, cursor.value));
      }
    }
    const rows = await this.tx
      .select({ inv: invoices, phone: leads.phoneE164, email: leads.email })
      .from(invoices)
      .innerJoin(leads, and(eq(leads.orgId, invoices.orgId), eq(leads.id, invoices.leadId)))
      .where(and(...conds))
      .orderBy(desc(invoices.createdAt), desc(invoices.id))
      .limit(page.limit + 1);
    const targets = rows.map((r) => this.toInvoiceTarget(r.inv, r.phone, r.email));
    return buildPage(targets, page, (t) => ({ createdAt: t.createdAt, id: t.id }));
  }
}
