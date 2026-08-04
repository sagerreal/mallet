import { and, eq, sql } from "drizzle-orm";
import { estimates, estimateDeposits } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId, EstimateId } from "@mallet/shared/types";
import type {
  EstimateDepositLedger,
  DepositLedgerEntry,
  DepositLedgerResult,
} from "../domain/estimate-deposit-ledger";

/**
 * The deposit ledger against Postgres. Two statements, one transaction (the caller's tenant tx):
 * append the payment, then re-derive the estimate's cached total from the ledger.
 *
 * RLS scopes the tx; the explicit org filters are defense-in-depth and index use.
 */
export class DrizzleEstimateDepositLedger implements EstimateDepositLedger {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async append(entry: DepositLedgerEntry): Promise<DepositLedgerResult> {
    /**
     * INSERT … SELECT, so the estimate's state is a precondition of the WRITE rather than of an
     * earlier read. The SELECT yields a row only while the quote is still an accepted, live
     * estimate of this org — a quote archived or moved off `accepted` between the use-case's load
     * and this statement produces zero source rows and therefore no deposit.
     *
     * ON CONFLICT (org_id, payment_ref) DO NOTHING is the idempotency: the second delivery of the
     * SAME payment_intent inserts nothing. DO NOTHING (not DO UPDATE) because a settled payment is
     * a fact — there is nothing about it to revise.
     */
    // Every bound value carries an explicit cast: in an INSERT … SELECT the select-list params
    // have no target column to infer a type from, so an uncast Date or int is handed to the driver
    // as an untyped parameter and rejected.
    const inserted = await this.tx.execute(sql`
      insert into ${estimateDeposits} (org_id, estimate_id, payment_ref, amount_cents, received_at)
      select ${this.orgId}::uuid,
             ${entry.estimateId}::uuid,
             ${entry.paymentRef}::text,
             ${entry.amountCents}::int,
             ${entry.receivedAt.toISOString()}::timestamptz
        from ${estimates}
       where ${estimates.id} = ${entry.estimateId}::uuid
         and ${estimates.orgId} = ${this.orgId}::uuid
         and ${estimates.status} = 'accepted'
         and ${estimates.deletedAt} is null
      on conflict (org_id, payment_ref) do nothing
      returning id
    `);

    if ((inserted as unknown as { length: number }).length === 0) {
      // Zero rows is ambiguous by itself — the conflict fired, OR the estimate could not take it.
      // Which one matters enormously (one is a harmless redelivery, the other is money with
      // nowhere to land), so ask the ledger which happened instead of guessing.
      const existing = await this.tx
        .select({ id: estimateDeposits.id })
        .from(estimateDeposits)
        .where(
          and(
            eq(estimateDeposits.orgId, this.orgId),
            eq(estimateDeposits.paymentRef, entry.paymentRef),
          ),
        )
        .limit(1);
      if (existing.length === 0) return { kind: "refused" };
      return { kind: "duplicate", depositPaidCents: await this.sumFor(entry.estimateId) };
    }

    return { kind: "appended", depositPaidCents: await this.syncCachedTotal(entry) };
  }

  /** The authoritative total: what this estimate's ledger rows add up to. */
  private async sumFor(estimateId: EstimateId): Promise<number> {
    const rows = await this.tx
      .select({ total: sql<number>`coalesce(sum(${estimateDeposits.amountCents}), 0)::int` })
      .from(estimateDeposits)
      .where(
        and(eq(estimateDeposits.orgId, this.orgId), eq(estimateDeposits.estimateId, estimateId)),
      );
    return rows[0]?.total ?? 0;
  }

  /**
   * Re-derive `estimates.dep_paid_cents` from the ledger. A SUM subquery in the UPDATE itself, not
   * a value computed in the app: the number is then a function of the rows, so two payments
   * accumulate and a redelivery changes nothing, without anyone having to reason about ordering.
   */
  private async syncCachedTotal(entry: DepositLedgerEntry): Promise<number> {
    const rows = await this.tx
      .update(estimates)
      .set({
        depPaidCents: sql`(
          select coalesce(sum(d.amount_cents), 0)::int
            from estimate_deposits d
           where d.org_id = ${this.orgId}::uuid and d.estimate_id = ${entry.estimateId}::uuid
        )`,
        updatedAt: entry.receivedAt,
      })
      .where(and(eq(estimates.id, entry.estimateId), eq(estimates.orgId, this.orgId)))
      .returning({ depPaidCents: estimates.depPaidCents });
    return rows[0]?.depPaidCents ?? (await this.sumFor(entry.estimateId));
  }
}
