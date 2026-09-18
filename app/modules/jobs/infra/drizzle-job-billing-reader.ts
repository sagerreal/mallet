import { and, eq, inArray, isNull } from "drizzle-orm";
import { invoices } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId, JobId } from "@mallet/shared/types";
import type { JobBillingReader, JobBillSummary } from "../domain/return-trip";

/** The statuses `invoices_status_check` allows — the boundary narrowing for a `text` column. */
const BILL_STATUSES: readonly JobBillSummary["status"][] = [
  "draft",
  "sent",
  "partial",
  "paid",
  "void",
];

const asBillStatus = (value: string): JobBillSummary["status"] =>
  // A row outside the check constraint should be impossible; if one ever exists, the safe reading
  // is the one that refuses a reopen rather than the one that waves it through.
  (BILL_STATUSES as readonly string[]).includes(value) ? (value as JobBillSummary["status"]) : "paid";

/**
 * The bill raised FROM a job, read directly and narrowly.
 *
 * THE PREDICATE IS `findBySourceJob`'s, EXACTLY — org, `source_job_id`, `deleted_at is null` — and
 * that is the whole point of the adapter. The rule it feeds exists because CreateInvoiceFromJobUseCase
 * is idempotent on precisely this lookup; a reader that asked a slightly different question would
 * refuse reopens for bills createFromJob cannot see, and allow reopens for bills it can.
 *
 * `scope_job_id` is deliberately NOT consulted. A visit fee collected at the door is lead-tied and
 * leaves the job's `invoices_org_source_job_uidx` slot free, so the job's real bill can still be
 * raised later and WILL carry the return trip's work. Blocking on it would refuse a return trip
 * over money that is not in the way.
 *
 * Three columns, no lines, no payment ledger: `amount_paid_cents` is maintained in the same
 * transaction as every payment, so the ledger sum is already here.
 */
export class DrizzleJobBillingReader implements JobBillingReader {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async readBillForJob(jobId: JobId): Promise<JobBillSummary | null> {
    const rows = await this.tx
      .select({
        num: invoices.num,
        status: invoices.status,
        amountPaidCents: invoices.amountPaidCents,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.orgId, this.orgId),
          eq(invoices.sourceJobId, jobId),
          isNull(invoices.deletedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return {
      num: row.num,
      status: asBillStatus(row.status),
      amountPaidCents: row.amountPaidCents,
    };
  }

  async readBillsForJobs(jobIds: readonly JobId[]): Promise<Map<JobId, JobBillSummary>> {
    if (jobIds.length === 0) return new Map();
    const rows = await this.tx
      .select({
        sourceJobId: invoices.sourceJobId,
        num: invoices.num,
        status: invoices.status,
        amountPaidCents: invoices.amountPaidCents,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.orgId, this.orgId),
          inArray(invoices.sourceJobId, [...jobIds]),
          isNull(invoices.deletedAt),
        ),
      );
    const out = new Map<JobId, JobBillSummary>();
    for (const row of rows) {
      if (row.sourceJobId === null) continue;
      // One bill per job (invoices_org_source_job_uidx) — a duplicate here would be corruption,
      // and the single-read twin above takes the first row too.
      out.set(row.sourceJobId as JobId, {
        num: row.num,
        status: asBillStatus(row.status),
        amountPaidCents: row.amountPaidCents,
      });
    }
    return out;
  }
}
