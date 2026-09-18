/**
 * As with the invoice handler, the job here is DISPOSITION: which failures return to the queue and
 * which are terminal.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QboPaymentSyncHandler, type QboPaymentSyncPorts } from "./qbo-payment-sync-handler";
import type { OutboxEvent, RelayHandlerContext } from "@mallet/shared/outbox";
import { ok, err, externalService, notFound, validation } from "@mallet/shared/types";

const CTX = { orgId: "org-1", tx: {} } as unknown as RelayHandlerContext;
const event = (payload: Record<string, unknown> = { invoiceId: "inv-1", paymentId: "pay-1" }): OutboxEvent =>
  ({ name: "invoice.payment.recorded", orgId: "org-1", payload }) as unknown as OutboxEvent;

const loaded = {
  payment: { id: "pay-1", invoiceId: "inv-1", amountCents: 110_000, receivedAt: new Date(2026, 6, 26) },
  customer: { id: "lead-1", name: "Dave's", email: null, phone: null, address: null },
};

const build = () => {
  const ports: QboPaymentSyncPorts = {
    loadSyncConfig: vi.fn(async () => ({ enabled: true })),
    access: vi.fn(async () => ok({ accessToken: "t", realmId: "9130" })),
    load: vi.fn(async () => loaded),
    sync: vi.fn(async () => ok({ qboId: "qbo-pay-5", alreadySent: false })),
  } as unknown as QboPaymentSyncPorts;
  return { ports, handler: new QboPaymentSyncHandler(ports) };
};

let h: ReturnType<typeof build>;
beforeEach(() => { h = build(); });

describe("QboPaymentSyncHandler", () => {
  it("applies a recorded payment", async () => {
    expect((await h.handler.handle(event(), CTX)).ok).toBe(true);
    expect(h.ports.sync).toHaveBeenCalled();
  });

  /**
   * Events emitted before paymentId was carried land here. Terminal: without the id there is no
   * way to tell this payment from another of the same amount, and guessing would either duplicate
   * money or drop it.
   */
  it("gives up on an event with no payment id rather than guessing", async () => {
    const r = await h.handler.handle(event({ invoiceId: "inv-1" }), CTX);
    expect(r.ok).toBe(true);
    expect(h.ports.loadSyncConfig).not.toHaveBeenCalled();
  });

  it("does nothing when the shop has not switched invoices on", async () => {
    (h.ports.loadSyncConfig as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ enabled: false });
    expect((await h.handler.handle(event(), CTX)).ok).toBe(true);
    expect(h.ports.sync).not.toHaveBeenCalled();
  });

  it("retries a transient QuickBooks failure", async () => {
    (h.ports.sync as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      err(externalService("quickbooks", "QuickBooks payment create failed", true)),
    );
    expect((await h.handler.handle(event(), CTX)).ok).toBe(false);
  });

  // The commonest terminal case — the invoice has not been sent yet, so there is nothing to link
  // to. Re-running cannot change that; the shop has to send the invoice.
  it("does not retry when the invoice is not in QuickBooks", async () => {
    (h.ports.sync as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      err(validation("the invoice this pays is not in QuickBooks yet", "invoice_not_in_quickbooks")),
    );
    expect((await h.handler.handle(event(), CTX)).ok).toBe(true);
  });

  it("gives up when the connection is dead", async () => {
    (h.ports.access as ReturnType<typeof vi.fn>).mockResolvedValueOnce(err(notFound("connection")));
    expect((await h.handler.handle(event(), CTX)).ok).toBe(true);
    expect(h.ports.sync).not.toHaveBeenCalled();
  });

  it("gives up on a payment that has since gone", async () => {
    (h.ports.load as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    expect((await h.handler.handle(event(), CTX)).ok).toBe(true);
    expect(h.ports.sync).not.toHaveBeenCalled();
  });
});
