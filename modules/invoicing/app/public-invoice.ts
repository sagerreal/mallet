import { and, eq, isNull } from "drizzle-orm";
import { invoices, orgs } from "@mallet/shared/db/schema";
import { ownerDb } from "@mallet/shared/db/owner-client";
import { withTenant, type TenantTx } from "@mallet/shared/db/tx";
import { loadConfig, resolvePublicAppOrigin } from "@mallet/shared/config";
import { asInvoiceId, asOrgId, isOk, type OrgId } from "@mallet/shared/types";
import { getSharedStripeClient } from "@mallet/platform/adapters/stripe/stripe-client";
import { DrizzleLeadRepository } from "@mallet/customers";
import { DrizzleSettingsRepository, GetBusinessIdentityUseCase } from "@mallet/settings";
import type { Invoice } from "../domain/invoice";
import { DrizzleInvoiceRepository } from "../infra/drizzle-invoice-repository";
import { DrizzleConnectTargetReader } from "../infra/drizzle-connect-target-reader";
import { DrizzleServiceDateReader } from "../infra/drizzle-service-date-reader";
import { StripePaymentLinkGateway } from "../infra/stripe-payment-link-gateway";
import {
  toPublicInvoiceView,
  createCheckoutWithDeps,
  type PublicInvoiceView,
  type PublicInvoiceContext,
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

/**
 * The facts a document of record states, gathered for ONE invoice inside its own org's tx.
 *
 * TENANT SAFETY. Every read below is constructed with `orgId` — the org resolved FROM the bearer
 * token, never from the caller — and runs inside `withTenant`, so RLS scopes each statement as
 * well. The lead is fetched BY THE INVOICE'S OWN `leadId`, not by anything the URL carries, so a
 * token cannot address another customer's record; the settings read takes no id at all.
 *
 * WHAT IS DELIBERATELY NOT READ: the lead's phone, email, notes or stage, the job's lines, the
 * technician's name. This page is unauthenticated. It states what a bill states and stops.
 */
async function loadDocumentContext(
  tx: TenantTx,
  orgId: OrgId,
  orgName: string,
  invoice: Invoice,
): Promise<PublicInvoiceContext> {
  const jobId = invoice.props.sourceJobId;
  const [target, identity, leads, serviceAt] = await Promise.all([
    // Whether the Pay button can exist at all: the shop finished Stripe Connect onboarding AND
    // can take charges. Read via the same seam the office checkout uses.
    new DrizzleConnectTargetReader(tx, orgId).read(),
    // The shop's identity, through the SETTINGS use-case — not a second query against
    // org_settings, so the four columns cannot mean one thing here and another in Settings.
    new GetBusinessIdentityUseCase(new DrizzleSettingsRepository(tx, orgId)).exec(orgId),
    new DrizzleLeadRepository(tx, orgId).findByIds([invoice.props.leadId]),
    // No source job means no service date. Omitted, never faked from the invoice date.
    jobId ? new DrizzleServiceDateReader(tx, orgId).forJob(jobId) : Promise.resolve(null),
  ]);

  const lead = leads[0];
  // A settings read that failed must not take the whole bill down with it — the customer still
  // needs their lines and their balance. The identity block simply does not render.
  const business = isOk(identity)
    ? {
        address: identity.value.address,
        phone: identity.value.phone,
        email: identity.value.email,
        site: identity.value.site,
        license: identity.value.license,
      }
    : { address: null, phone: null, email: null, site: null, license: null };

  return {
    orgName,
    chargesEnabled: Boolean(target.connectedAccountId && target.chargesEnabled),
    business,
    customerName: lead?.props.name ?? null,
    // Nullable by design — most leads are created without one (see the leads.address comment).
    serviceAddress: lead?.props.address ?? null,
    serviceAt,
  };
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

    const context = await loadDocumentContext(tx, resolved.orgId, resolved.orgName, invoice);
    return toPublicInvoiceView(invoice, context);
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
