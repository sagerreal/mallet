import { and, eq, inArray } from "drizzle-orm";
import { invoices, leads, payments, timeEntries, users } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { SyncLabelReader } from "../domain/sync-label-reader";

/** "Jul 25" — short, because the row already carries the attempt time. */
const shortDate = (workDate: string): string => {
  // `work_date` is a Postgres `date`; parsing it through a JS Date without an anchor shifts it a
  // day either side of midnight in most timezones. Noon is far enough from both DST boundaries.
  const d = new Date(`${workDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return workDate;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/**
 * Resolves sync-log ids to names, one entity type at a time.
 *
 * Unknown types return an empty map rather than throwing: this reader will be asked about
 * `invoice` and `payment` before those are implemented, and a settings screen must not 500 because
 * it met a row it cannot name.
 */
export class DrizzleSyncLabelReader implements SyncLabelReader {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: string,
  ) {}

  async labelsFor(
    entityType: string,
    malletIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    if (malletIds.length === 0) return new Map();
    if (entityType === "customer") return this.customerLabels(malletIds);
    if (entityType === "invoice") return this.invoiceLabels(malletIds);
    if (entityType === "payment") return this.paymentLabels(malletIds);
    if (entityType !== "time_entry") return new Map();

    const rows = await this.tx
      .select({
        id: timeEntries.id,
        workDate: timeEntries.workDate,
        name: users.name,
        email: users.email,
      })
      .from(timeEntries)
      .leftJoin(users, eq(users.id, timeEntries.techUserId))
      .where(and(eq(timeEntries.orgId, this.orgId), inArray(timeEntries.id, [...malletIds])));

    // Email is the fallback because a user who never set a display name still has one, and an
    // unnamed row on this screen is as useless as the UUID it replaced.
    return new Map(
      rows.map((r) => [r.id, `${r.name ?? r.email ?? "Someone"} · ${shortDate(r.workDate)}`]),
    );
  }

  /** Customers are named by their own name — nothing else on the row means anything to a shop. */
  private async customerLabels(malletIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const rows = await this.tx
      .select({ id: leads.id, name: leads.name })
      .from(leads)
      .where(and(eq(leads.orgId, this.orgId), inArray(leads.id, [...malletIds])));
    return new Map(rows.map((r) => [r.id, r.name]));
  }


  /** Invoices by their number — what a shop reconciles against in QuickBooks. */
  private async invoiceLabels(malletIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const rows = await this.tx
      .select({ id: invoices.id, num: invoices.num })
      .from(invoices)
      .where(and(eq(invoices.orgId, this.orgId), inArray(invoices.id, [...malletIds])));
    return new Map(rows.map((r) => [r.id, r.num]));
  }


  /**
   * Payments by the invoice they settle plus their amount — "INV-1001 · $1,100.00".
   *
   * A payment has no name of its own, and left unlabelled it would render as "(no longer in
   * Mallet)": the fallback for a DELETED record, which would read as data loss on a row that is
   * perfectly fine.
   */
  private async paymentLabels(malletIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const rows = await this.tx
      .select({ id: payments.id, amountCents: payments.amountCents, num: invoices.num })
      .from(payments)
      .leftJoin(invoices, eq(invoices.id, payments.invoiceId))
      .where(and(eq(payments.orgId, this.orgId), inArray(payments.id, [...malletIds])));
    return new Map(
      rows.map((r) => {
        const amount = (r.amountCents / 100).toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
        });
        return [r.id, r.num ? `${r.num} · ${amount}` : amount];
      }),
    );
  }

}
