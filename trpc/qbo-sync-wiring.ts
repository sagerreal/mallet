import { asUserId, systemClock } from "@mallet/shared/types";
import type { RelayHandlerContext } from "@mallet/shared/outbox";
import { DrizzleTimeEntryRepository } from "@mallet/timesheets";
import {
  DrizzleQboConnectionRepository,
  DrizzleQboEntityLinkRepository,
  DrizzleQboSyncLogRepository,
  EnsureFreshAccessToken,
  HttpQboApiGateway,
  SyncApprovedHours,
  EnsureQboCustomer,
  SyncInvoice,
  SyncPayment,
  ResyncInvoice,
  QboInvoiceSyncHandler,
  QboPaymentSyncHandler,
  type QboTimeSyncPorts,
  type QboInvoiceSyncPorts,
  type QboPaymentSyncPorts,
  type QboInvoiceChangePorts,
  type SyncableTimeEntry,
} from "@mallet/accounting-sync";
import { DrizzleInvoiceRepository } from "@mallet/invoicing";
import { DrizzleLeadRepository } from "@mallet/customers";
import { asInvoiceId } from "@mallet/shared/types";
import { loadConfig } from "@mallet/shared/config";
import { getAppDeps } from "./di";

// Composition for the QuickBooks time-sync outbox handler. Lives here (not in the module) because
// it wires the accounting-sync module to the TIMESHEETS module — cross-module assembly belongs at
// the composition root, not inside either module.

const MAX_ENTRIES_PER_WEEK = 500; // A week for one tech; far above any real crew's volume.

export const buildQboTimeSyncPorts = (): QboTimeSyncPorts => ({
  loadSyncConfig: async (ctx: RelayHandlerContext) => {
    const repo = new DrizzleQboConnectionRepository(ctx.tx, ctx.orgId);
    const connection = await repo.get();
    if (!connection) return null;
    return {
      enabled: connection.props.sendApprovedHours,
      defaultItemQboId: connection.props.defaultItemQboId,
    };
  },

  access: async (ctx: RelayHandlerContext) => {
    const deps = getAppDeps();
    if (!deps.qboOauthGateway || !deps.qboSecretBox) {
      // Unconfigured server. Not retryable — waiting won't add credentials.
      return { ok: false, error: { kind: "not_found", message: "QuickBooks is not configured" } } as never;
    }
    const repo = new DrizzleQboConnectionRepository(ctx.tx, ctx.orgId);
    const result = await new EnsureFreshAccessToken(
      repo,
      deps.qboOauthGateway,
      deps.qboSecretBox,
      deps.clock ?? systemClock,
    ).exec(ctx.orgId);
    if (!result.ok) return result;
    return { ok: true, value: { accessToken: result.value.accessToken, realmId: result.value.realmId } };
  },

  loadEntries: async (ctx, techUserId, dates) => {
    const repo = new DrizzleTimeEntryRepository(ctx.tx, ctx.orgId);
    const sorted = [...dates].sort();
    // The repo filters by RANGE; narrow to the exact approved dates afterwards. Reusing the
    // existing query beats widening the timesheets repository for one caller.
    const page = await repo.list(
      {
        techUserId: asUserId(techUserId),
        fromDate: sorted[0] as string,
        toDate: sorted[sorted.length - 1] as string,
      },
      { cursor: null, limit: MAX_ENTRIES_PER_WEEK },
    );

    const wanted = new Set(dates);
    const entries: SyncableTimeEntry[] = [];
    for (const e of page.items) {
      const p = e.props;
      // Only APPROVED entries are ever pushed — approval is the shop's explicit sign-off, and a
      // draft could still change.
      if (p.status !== "approved") continue;
      if (!wanted.has(p.workDate)) continue;
      entries.push({
        id: p.id,
        techUserId: p.techUserId,
        workDate: p.workDate,
        kind: p.kind,
        startTime: p.startTime,
        endTime: p.endTime,
        note: p.note,
      });
    }
    return entries;
  },

  sync: async (ctx, techUserId, entries, defaultItemQboId, access) => {
    const config = loadConfig();
    const api = new HttpQboApiGateway(config.QBO_ENVIRONMENT);
    const links = new DrizzleQboEntityLinkRepository(ctx.tx, ctx.orgId);
    const syncLog = new DrizzleQboSyncLogRepository(ctx.tx, ctx.orgId);
    return new SyncApprovedHours(api, links, syncLog, systemClock).exec(
      { techUserId, entries, defaultItemQboId },
      access,
      ctx.orgId,
    );
  },

  markSynced: async (ctx, at) => {
    const repo = new DrizzleQboConnectionRepository(ctx.tx, ctx.orgId);
    const connection = await repo.get();
    if (connection) await repo.save(connection.withLastSyncAt(at));
  },
});

// Composition for the QuickBooks INVOICE-sync handler. Same reason it lives here: it wires
// accounting-sync to the INVOICING and CUSTOMERS modules, and cross-module assembly belongs at the
// composition root rather than inside any of them.
export const buildQboInvoiceSyncPorts = (): QboInvoiceSyncPorts => ({
  loadSyncConfig: async (ctx: RelayHandlerContext) => {
    const repo = new DrizzleQboConnectionRepository(ctx.tx, ctx.orgId);
    const connection = await repo.get();
    if (!connection) return null;
    return {
      // Its OWN switch. A shop sending hours has not thereby agreed to send its invoicing.
      enabled: connection.props.sendInvoices,
      invoiceItemQboId: connection.props.defaultInvoiceItemQboId,
    };
  },

  access: buildQboTimeSyncPorts().access,

  load: async (ctx, invoiceId) => {
    const invoices = new DrizzleInvoiceRepository(ctx.tx, ctx.orgId);
    const invoice = await invoices.findById(asInvoiceId(invoiceId));
    if (!invoice) return null;
    const leads = new DrizzleLeadRepository(ctx.tx, ctx.orgId);
    const lead = await leads.findById(invoice.props.leadId);
    // No customer means no CustomerRef, and QuickBooks requires one. Reported as "gone" rather
    // than pushed against a placeholder.
    if (!lead) return null;
    return {
      invoice: {
        id: invoice.props.id,
        num: invoice.props.num,
        title: invoice.props.title,
        totalCents: invoice.props.total,
        taxCents: invoice.props.tax,
        sentAt: invoice.props.sentAt,
        dueAt: invoice.props.dueAt,
      },
      customer: {
        id: lead.props.id,
        name: lead.props.name,
        email: lead.props.email,
        phone: lead.props.phone ?? null,   // Phone is a branded string, not a wrapper
        address: lead.props.address,
      },
    };
  },

  sync: async (ctx, invoice, customer, invoiceItemQboId, access) => {
    const config = loadConfig();
    const api = new HttpQboApiGateway(config.QBO_ENVIRONMENT);
    const links = new DrizzleQboEntityLinkRepository(ctx.tx, ctx.orgId);
    const syncLog = new DrizzleQboSyncLogRepository(ctx.tx, ctx.orgId);
    const customers = new EnsureQboCustomer(api, links, syncLog, systemClock);
    return new SyncInvoice(api, customers, links, syncLog, systemClock).exec(
      { invoice, customer, invoiceItemQboId },
      access,
      ctx.orgId,
    );
  },
});

// Composition for the QuickBooks PAYMENT-sync handler.
export const buildQboPaymentSyncPorts = (): QboPaymentSyncPorts => ({
  loadSyncConfig: async (ctx: RelayHandlerContext) => {
    const repo = new DrizzleQboConnectionRepository(ctx.tx, ctx.orgId);
    const connection = await repo.get();
    if (!connection) return null;
    // Shares the INVOICE switch on purpose: a shop sending invoices but not their payments would
    // watch its receivables climb with money it has already banked. The two are one feature.
    return { enabled: connection.props.sendInvoices };
  },

  access: buildQboTimeSyncPorts().access,

  load: async (ctx, invoiceId, paymentId) => {
    const invoices = new DrizzleInvoiceRepository(ctx.tx, ctx.orgId);
    const invoice = await invoices.findById(asInvoiceId(invoiceId));
    if (!invoice) return null;
    const row = invoice.props.payments.find((p) => p.props.id === paymentId);
    if (!row) return null;
    const leads = new DrizzleLeadRepository(ctx.tx, ctx.orgId);
    const lead = await leads.findById(invoice.props.leadId);
    if (!lead) return null;
    return {
      payment: {
        id: row.props.id,
        invoiceId: invoice.props.id,
        amountCents: row.props.amount,
        receivedAt: row.props.receivedAt,
      },
      customer: {
        id: lead.props.id,
        name: lead.props.name,
        email: lead.props.email,
        phone: lead.props.phone ?? null,
        address: lead.props.address,
      },
    };
  },

  sync: async (ctx, payment, customer, access) => {
    const config = loadConfig();
    const api = new HttpQboApiGateway(config.QBO_ENVIRONMENT);
    const links = new DrizzleQboEntityLinkRepository(ctx.tx, ctx.orgId);
    const syncLog = new DrizzleQboSyncLogRepository(ctx.tx, ctx.orgId);
    const customers = new EnsureQboCustomer(api, links, syncLog, systemClock);
    return new SyncPayment(api, customers, links, syncLog, systemClock).exec(
      { payment, customer },
      access,
      ctx.orgId,
    );
  },
});

// Composition for the QuickBooks invoice EDIT/VOID handler.
export const buildQboInvoiceChangePorts = (): QboInvoiceChangePorts => ({
  loadSyncConfig: buildQboInvoiceSyncPorts().loadSyncConfig,
  access: buildQboTimeSyncPorts().access,

  load: async (ctx, invoiceId) => {
    const invoices = new DrizzleInvoiceRepository(ctx.tx, ctx.orgId);
    const invoice = await invoices.findById(asInvoiceId(invoiceId));
    if (!invoice) return null;
    const links = new DrizzleQboEntityLinkRepository(ctx.tx, ctx.orgId);
    // The customer link, NOT EnsureQboCustomer: an edit must never create a customer in
    // QuickBooks as a side effect. If the link has gone, the use-case refuses and says so.
    const customerLink = await links.find("customer", invoice.props.leadId);
    return {
      invoice: {
        id: invoice.props.id,
        num: invoice.props.num,
        title: invoice.props.title,
        totalCents: invoice.props.total,
        taxCents: invoice.props.tax,
        sentAt: invoice.props.sentAt,
        dueAt: invoice.props.dueAt,
      },
      customerQboId: customerLink?.qboId ?? null,
    };
  },

  update: async (ctx, invoice, customerQboId, invoiceItemQboId, access) =>
    buildResync(ctx).update(invoice, customerQboId, invoiceItemQboId, access, ctx.orgId),

  void: async (ctx, invoiceId, access) => buildResync(ctx).void(invoiceId, access, ctx.orgId),
});

const buildResync = (ctx: RelayHandlerContext): ResyncInvoice => {
  const config = loadConfig();
  return new ResyncInvoice(
    new HttpQboApiGateway(config.QBO_ENVIRONMENT),
    new DrizzleQboEntityLinkRepository(ctx.tx, ctx.orgId),
    new DrizzleQboSyncLogRepository(ctx.tx, ctx.orgId),
    systemClock,
  );
};
