import { InvoicePaidAuditHandler } from "@mallet/invoicing";
import { QboTimeSyncHandler } from "@mallet/accounting-sync";
import { systemClock } from "@mallet/shared/types";
import { buildQboTimeSyncPorts } from "./qbo-sync-wiring";
import type { OutboxHandlerMap } from "@mallet/shared/outbox";

// Composition root for outbox relay handlers — the EXPLICIT allow-list of which events get a side
// effect. Everything NOT listed here is drained as a no-op by the relay (marked published, no
// effect), which keeps the unpublished index equal to real pending work.
//
// NOTE: no notification/auto-notify handler is registered. Auto-emailing/texting a customer on
// invoice.sent / invoice.paid is a product-behavior change (today notifications are a manual office
// action) and, for SMS, unsafe until a per-message dedupe token lands — both pending sign-off.
export const buildOutboxHandlers = (): OutboxHandlerMap =>
  new Map([
    ["invoice.paid", new InvoicePaidAuditHandler()],
    // Approving a week is what triggers the QuickBooks push. Self-disables when the org hasn't
    // connected or hasn't switched the push on, so registering it is safe for every tenant.
    ["timeEntry.weekApproved", new QboTimeSyncHandler(buildQboTimeSyncPorts(), systemClock)],
  ]);
