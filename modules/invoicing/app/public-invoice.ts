import { and, eq, isNull } from "drizzle-orm";
import { invoices, orgs } from "@mallet/shared/db/schema";
import { ownerDb } from "@mallet/shared/db/owner-client";
import { withTenant, type TenantTx } from "@mallet/shared/db/tx";
import { loadConfig, resolvePublicAppOrigin } from "@mallet/shared/config";
import { asInvoiceId, asOrgId, isOk, type OrgId } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { getSharedStripeClient } from "@mallet/platform/adapters/stripe/stripe-client";
import { DrizzleLeadRepository } from "@mallet/customers";
import {
  DrizzleSettingsRepository,
  GetBusinessIdentityUseCase,
  GetDocumentWordingUseCase,
} from "@mallet/settings";
import type { Invoice } from "../domain/invoice";
import { DrizzleInvoiceRepository } from "../infra/drizzle-invoice-repository";
import { DrizzleConnectTargetReader } from "../infra/drizzle-connect-target-reader";
import { DrizzleAuthorizationReader } from "../infra/drizzle-authorization-reader";
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

/** An identity block that prints nothing — what an unfilled shop, or an unreadable one, states. */
const NO_BUSINESS: PublicInvoiceContext["business"] = {
  address: null,
  phone: null,
  email: null,
  site: null,
  license: null,
};

/**
 * The shop's identity, through the settings use-case — not a second query against org_settings, so
 * these five facts cannot mean one thing here and another in Settings.
 *
 * IT CANNOT TAKE THE BILL DOWN WITH IT, and that is why this is not a bare `await`. The customer
 * needs their lines, their balance and their Pay button; the letterhead is the part of the page
 * they can do without. Two failure modes are absorbed here and only here:
 *
 *   • the use-case returning an error Result, and
 *   • `toOrgSettings` THROWING on an org_settings row that fails domain validation — a real path,
 *     since the mapper turns a corrupt row into an exception by design. Before this read existed
 *     the public page never built the settings aggregate at all (the Connect check is a focused
 *     column read), so one bad row would newly have 500'd a customer's invoice.
 *
 * NOT A SILENT FAILURE: it logs with the org id, and the office's own Settings page still surfaces
 * the same corruption loudly, which is where a shop can act on it.
 */
async function readBusiness(tx: TenantTx, orgId: OrgId): Promise<PublicInvoiceContext["business"]> {
  try {
    const result = await new GetBusinessIdentityUseCase(
      new DrizzleSettingsRepository(tx, orgId),
    ).exec(orgId);
    if (!isOk(result)) {
      logger.warn({ orgId, kind: result.error.kind }, "publicInvoice.identity.unavailable");
      return NO_BUSINESS;
    }
    const { address, phone, email, site, license } = result.value;
    return { address, phone, email, site, license };
  } catch (err) {
    logger.error({ orgId, err: String(err) }, "publicInvoice.identity.failed");
    return NO_BUSINESS;
  }
}

/** The wording an untouched (or unreadable) shop renders: every slot at its standard sentence. */
const NO_WORDING: PublicInvoiceContext["wording"] = {
  invoiceFooter: null,
  payInstructions: null,
  receiptNote: null,
};

/**
 * The org's document-wording overrides, through the settings use-case — same seam and same
 * failure posture as readBusiness above: the customer needs their lines, balance and Pay
 * button, and a settings read that did not answer must degrade to the STANDARD sentences,
 * never take the bill down. Logged, not silent.
 */
async function readWording(tx: TenantTx, orgId: OrgId): Promise<PublicInvoiceContext["wording"]> {
  try {
    const result = await new GetDocumentWordingUseCase(
      new DrizzleSettingsRepository(tx, orgId),
    ).exec(orgId);
    if (!isOk(result)) {
      logger.warn({ orgId, kind: result.error.kind }, "publicInvoice.wording.unavailable");
      return NO_WORDING;
    }
    const { invoiceFooter, payInstructions, receiptNote } = result.value;
    return { invoiceFooter, payInstructions, receiptNote };
  } catch (err) {
    logger.error({ orgId, err: String(err) }, "publicInvoice.wording.failed");
    return NO_WORDING;
  }
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
  const [target, business, wording, leads, serviceAt, auth] = await Promise.all([
    // Whether the Pay button can exist at all: the shop finished Stripe Connect onboarding AND
    // can take charges. Read via the same seam the office checkout uses.
    new DrizzleConnectTargetReader(tx, orgId).read(),
    readBusiness(tx, orgId),
    readWording(tx, orgId),
    new DrizzleLeadRepository(tx, orgId).findByIds([invoice.props.leadId]),
    // No source job means no service date. Omitted, never faked from the invoice date.
    jobId ? new DrizzleServiceDateReader(tx, orgId).forJob(jobId) : Promise.resolve(null),
    // The signature this bill rests on — the SAME reader the office sheet cites, so the two copies
    // of one bill can never disagree about who approved it. No source job means nothing was signed.
    jobId ? new DrizzleAuthorizationReader(tx, orgId).forJob(jobId) : Promise.resolve(null),
  ]);

  const lead = leads[0];

  return {
    orgName,
    chargesEnabled: Boolean(target.connectedAccountId && target.chargesEnabled),
    business,
    customerName: lead?.props.name ?? null,
    // Nullable by design — most leads are created without one (see the leads.address comment).
    serviceAddress: lead?.props.address ?? null,
    serviceAt,
    wording,
    // The citation only. The office's OVERAGE warning deliberately stays behind: a bill exceeding
    // what was signed is something for the shop to fix before sending, not an argument to hand the
    // customer inside their own copy.
    authorization: auth
      ? {
          signerName: auth.signerName,
          signedAt: auth.signedAt,
          documentRef: auth.documentRef,
          authorizedCents: auth.authorizedCents,
        }
      : null,
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
