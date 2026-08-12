import { TRPCError } from "@trpc/server";
import type { InvoiceId } from "@mallet/shared/types";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { Principal } from "@mallet/identity";
import type { Invoice } from "../domain/invoice";
import { DrizzleInvoiceRepository } from "../infra/drizzle-invoice-repository";
import { DrizzleFieldScopeReader } from "../infra/drizzle-field-scope-reader";
import { assertFieldInvoiceScope, fieldInvoiceNotFound } from "./field-invoice-guard";

/**
 * The load-and-authorize step shared by every field-callable money procedure — extracted from
 * field-invoice-router.ts when the Terminal router gained invoice-addressed procedures, so the
 * two surfaces cannot drift apart on the one check that matters most.
 */

export interface FieldCtx {
  readonly tx: TenantTx;
  readonly principal: Principal;
}

export const scopeReaderFor = (ctx: FieldCtx) =>
  new DrizzleFieldScopeReader(ctx.tx, ctx.principal.orgId);

/**
 * Load an invoice and prove the caller may transact on it, in that order.
 *
 * A missing invoice and an out-of-scope one raise the SAME NOT_FOUND with the same sentence — see
 * field-invoice-guard.ts. Distinguishing them is what would make this an existence oracle.
 */
export const loadInvoiceInScope = async (invoiceId: InvoiceId, ctx: FieldCtx): Promise<Invoice> => {
  const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
  const invoice = await repo.findById(invoiceId);
  if (!invoice) {
    // Owner/office get the ordinary answer; only a technician gets the flattened one.
    if (ctx.principal.role !== "tech") {
      throw new TRPCError({ code: "NOT_FOUND", message: "invoice not found" });
    }
    throw fieldInvoiceNotFound();
  }
  await assertFieldInvoiceScope(invoice, scopeReaderFor(ctx), ctx.principal);
  return invoice;
};
