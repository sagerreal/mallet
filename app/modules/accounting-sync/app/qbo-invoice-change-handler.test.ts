import { describe, it, expect, vi, beforeEach } from "vitest";
import { QboInvoiceChangeHandler, type QboInvoiceChangePorts } from "./qbo-invoice-change-handler";
import type { OutboxEvent, RelayHandlerContext } from "@mallet/shared/outbox";
import { ok, err, externalService, notFound, validation } from "@mallet/shared/types";

const CTX = { orgId: "org-1", tx: {} } as unknown as RelayHandlerContext;
const event = (payload: Record<string, unknown> = { invoiceId: "inv-1" }): OutboxEvent =>
  ({ name: "invoice.updated", orgId: "org-1", payload }) as unknown as OutboxEvent;

const invoice = {
  id: "inv-1", num: "INV-1001", title: null,
  totalCents: 120_000, taxCents: 9_661, sentAt: new Date(2026, 6, 25), dueAt: null,
};

const build = () => {
  const ports: QboInvoiceChangePorts = {
    loadSyncConfig: vi.fn(async () => ({ enabled: true, invoiceItemQboId: "14" })),
    access: vi.fn(async () => ok({ accessToken: "t", realmId: "9130" })),
    load: vi.fn(async () => ({ invoice, customerQboId: "qbo-cust-3" })),
    update: vi.fn(async () => ok({ outcome: "updated" as const })),
    void: vi.fn(async () => ok({ outcome: "voided" as const })),
  } as unknown as QboInvoiceChangePorts;
  return {
    ports,
    updater: new QboInvoiceChangeHandler(ports, "update"),
    voider: new QboInvoiceChangeHandler(ports, "void"),
  };
};

let h: ReturnType<typeof build>;
beforeEach(() => { h = build(); });

describe("QboInvoiceChangeHandler", () => {
  it("carries an edit through", async () => {
    expect((await h.updater.handle(event(), CTX)).ok).toBe(true);
    expect(h.ports.update).toHaveBeenCalled();
    expect(h.ports.void).not.toHaveBeenCalled();
  });

  // The void path needs no invoice load — the link alone identifies what to void.
  it("carries a void through without loading the invoice", async () => {
    expect((await h.voider.handle(event(), CTX)).ok).toBe(true);
    expect(h.ports.void).toHaveBeenCalledWith(CTX, "inv-1", expect.anything());
    expect(h.ports.load).not.toHaveBeenCalled();
  });

  it("does nothing when the shop has not switched invoices on", async () => {
    (h.ports.loadSyncConfig as ReturnType<typeof vi.fn>).mockResolvedValue({ enabled: false, invoiceItemQboId: "14" });
    expect((await h.updater.handle(event(), CTX)).ok).toBe(true);
    expect(h.ports.update).not.toHaveBeenCalled();
  });

  it("treats a malformed event as terminal", async () => {
    expect((await h.updater.handle(event({}), CTX)).ok).toBe(true);
    expect(h.ports.loadSyncConfig).not.toHaveBeenCalled();
  });

  it("retries a transient QuickBooks failure", async () => {
    (h.ports.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      err(externalService("quickbooks", "QuickBooks invoice update failed", true)),
    );
    expect((await h.updater.handle(event(), CTX)).ok).toBe(false);
  });

  // A stale token or an unlinked customer needs a person, not another attempt.
  it("does not retry a refusal that needs a person", async () => {
    (h.ports.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      err(validation("this invoice's customer is no longer matched", "customer_not_linked")),
    );
    expect((await h.updater.handle(event(), CTX)).ok).toBe(true);
  });

  it("gives up when the connection is dead", async () => {
    (h.ports.access as ReturnType<typeof vi.fn>).mockResolvedValueOnce(err(notFound("connection")));
    expect((await h.updater.handle(event(), CTX)).ok).toBe(true);
    expect(h.ports.update).not.toHaveBeenCalled();
  });

  it("does nothing for an invoice deleted since the edit", async () => {
    (h.ports.load as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    expect((await h.updater.handle(event(), CTX)).ok).toBe(true);
    expect(h.ports.update).not.toHaveBeenCalled();
  });
});
