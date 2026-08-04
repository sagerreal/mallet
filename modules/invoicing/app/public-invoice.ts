import { and, eq, isNull } from "drizzle-orm";
import { invoices, orgs } from "@mallet/shared/db/schema";
import { ownerDb } from "@mallet/shared/db/owner-client";
import { withTenant } from "@mallet/shared/db/tx";
import { loadConfig, resolvePublicAppOrigin } from "@mallet/shared/config";
import { asInvoiceId, asOrgId, type OrgId } from "@mallet/shared/types";
import { getSharedStripeClient } from "@mallet/platform/adapters/stripe/stripe-client";
import { DrizzleInvoiceRepository } from "../infra/drizzle-invoice-repository";
import { DrizzleConnectTargetReader } from "../infra/drizzle-connect-target-reader";
import { StripePaymentLinkGateway } from "../infra/stripe-payment-link-gateway";
import {
  toPublicInvoiceView,
  createCheckoutWithDeps,
  type PublicInvoiceView,
  type PublicCheckoutOutcome,
} from "./public-invoice-view";

// Public (unauthenticated) invoice access, mirroring modules/quoting/app/public-quote.ts. The
// unguessable public_token is the ONLY credential: the org is resolved FROM the token via a
// minimal ownerDb (BYPASSRLS) lookup, then all tenant reads/writes re-enter withTenant so RLS
// scopes them. No org_id or invoice_id is ever accepted from the caller.

// Re-export the view/outcome types so routes keep a single import surface.
export type { PublicInvoiceView, PublicCheckoutOutcome };

/**
 * Resolve (invoiceId, orgId, orgName) from a public token — the pre-tenant bootstrap lookup.
 * orgName comes from the DB, never from the page: the customer-facing header names the shop, and
 * a client-supplied counterparty name on a money page is a hole, not a convenience.
 * Returns null when the token matches no active (non-deleted) invoice.
 */
export async function resolveInvoiceOrgByToken(
  db: typeof ownerDb,
  token: string,
): Promise<{ invoiceId: string; orgId: OrgId; orgName: string } | null> {
  const rows = await db
    .select({ id: invoices.id, orgId: invoices.orgId, orgName: orgs.name })
    .from(invoices)
    .innerJoin(orgs, eq(orgs.id, invoices.orgId))
    .where(and(eq(invoices.publicToken, token), isNull(invoices.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { invoiceId: row.id, orgId: asOrgId(row.orgId), orgName: row.orgName };
}

// Fetch the public invoice view for a token. Returns null when the token does not match any
// active invoice. Read-only — nothing is stamped (unlike quotes, invoices track no first-view).
export async function getPublicInvoice(token: string): Promise<PublicInvoiceView | null> {
  const resolved = await resolveInvoiceOrgByToken(ownerDb, token);
  if (!resolved) return null;

  return withTenant(resolved.orgId, async (tx) => {
    const repo = new DrizzleInvoiceRepository(tx, resolved.orgId);
    const invoice = await repo.findByPublicToken(token);
    if (!invoice) return null;

    // Whether the Pay button can exist at all: the shop finished Stripe Connect onboarding AND
    // can take charges. Read via the same seam the office checkout uses.
    const target = await new DrizzleConnectTargetReader(tx, resolved.orgId).read();
    const chargesEnabled = Boolean(target.connectedAccountId && target.chargesEnabled);

    return toPublicInvoiceView(invoice, resolved.orgName, chargesEnabled);
  });
}

// Create a Stripe-hosted checkout for the invoice's balance via its public token. Reuses
// CreatePaymentUseCase inside withTenant (see createCheckoutWithDeps) — no parallel payment path.
export async function createPublicInvoiceCheckout(token: string): Promise<PublicCheckoutOutcome> {
  const resolved = await resolveInvoiceOrgByToken(ownerDb, token);
  if (!resolved) return { kind: "not_found" };

  const config = loadConfig();
  const origin = resolvePublicAppOrigin(config);
  if (!config.STRIPE_SECRET_KEY || !origin) {
    // Stripe unconfigured on this deployment — the same dark state the office path reports.
    return { kind: "rejected", message: "Online payment isn't available right now — contact the business to pay." };
  }
  // Shared process-wide client: the breaker only works if it sees ALL Stripe traffic.
  const stripe = getSharedStripeClient(config.STRIPE_SECRET_KEY);

  return withTenant(resolved.orgId, async (tx) => {
    return createCheckoutWithDeps(resolved.orgId, asInvoiceId(resolved.invoiceId), {
      repo: new DrizzleInvoiceRepository(tx, resolved.orgId),
      gateway: new StripePaymentLinkGateway(stripe, origin),
      connect: new DrizzleConnectTargetReader(tx, resolved.orgId),
    });
  });
}
