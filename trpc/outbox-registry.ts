import { InvoicePaidAuditHandler } from "@mallet/invoicing";
import type { OutboxHandlerMap } from "@mallet/shared/outbox";

// Composition root for outbox relay handlers — the EXPLICIT allow-list of which events get a side
// effect. Everything NOT listed here is drained as a no-op by the relay (marked published, no
// effect), which keeps the unpublished index equal to real pending work.
//
// NOTE: no notification/auto-notify handler is registered. Auto-emailing/texting a customer on
// invoice.sent / invoice.paid is a product-behavior change (today notifications are a manual office
// action) and, for SMS, unsafe until a per-message dedupe token lands — both pending sign-off.
export const buildOutboxHandlers = (): OutboxHandlerMap =>
  new Map([["invoice.paid", new InvoicePaidAuditHandler()]]);
