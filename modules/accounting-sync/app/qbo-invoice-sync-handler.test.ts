/**
 * The handler's whole job is DISPOSITION: which failures go back on the queue and which are
 * terminal. Get it wrong in one direction and a QuickBooks outage loses an invoice permanently;
 * get it wrong in the other and a shop that simply hasn't switched the feature on has an event
 * spinning in the relay forever.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QboInvoiceSyncHandler, type QboInvoiceSyncPorts } from "./qbo-invoice-sync-handler";
import type { OutboxEvent, RelayHandlerContext } from "@mallet/shared/outbox";
import { ok, err, externalService, notFound } from "@mallet/shared/types";

const CTX = { orgId: "org-1", tx: {} } as unknown as RelayHandlerContext;
const event = (payload: Record<string, unknown> = { invoiceId: "inv-1" }): OutboxEvent =>
  ({ name: "invoice.sent", orgId: "org-1", payload }) as unknown as OutboxEvent;

const loaded = {
  invoice: {
    id: "inv-1",
    num: "INV-1001",
    title: null,
    totalCents: 110_000,
    taxCents: 8_855,
    sentAt: new Date(2026, 6, 25),
    dueAt: null,
  },
  customer: { id: "lead-1", name: "Dave's", email: null, phone: null, address: null },
};

const build = () => {
  const ports: QboInvoiceSyncPorts = {
    loadSyncConfig: vi.fn(async () => ({ enabled: true, invoiceItemQboId: "14" })),
    access: vi.fn(async () => ok({ accessToken: "t", realmId: "9130" })),
    load: vi.fn(async () => loaded),
    sync: vi.fn(async () => ok({ qboId: "qbo-9", alreadySent: false })),
  } as unknown as QboInvoiceSyncPorts;
  return { ports, handler: new QboInvoiceSyncHandler(ports) };
};

let h: ReturnType<typeof build>;
beforeEach(() => {
  h = build();
});

describe("QboInvoiceSyncHandler", () => {
  it("pushes a sent invoice", async () => {
    expect((await h.handler.handle(event(), CTX)).ok).toBe(true);
    expect(h.ports.sync).toHaveBeenCalled();
  });

  it("does nothing, terminally, when the shop has not switched invoices on", async () => {
    (h.ports.loadSyncConfig as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      enabled: false,
      invoiceItemQboId: "14",
    });
    const r = await h.handler.handle(event(), CTX);
    expect(r.ok).toBe(true); // terminal — must NOT spin the relay
    expect(h.ports.sync).not.toHaveBeenCalled();
  });

  it("does nothing when QuickBooks is not connected at all", async () => {
    (h.ports.loadSyncConfig as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    expect((await h.handler.handle(event(), CTX)).ok).toBe(true);
    expect(h.ports.sync).not.toHaveBeenCalled();
  });

  it("treats a malformed event as terminal — it will never become valid", async () => {
    const r = await h.handler.handle(event({}), CTX);
    expect(r.ok).toBe(true);
    expect(h.ports.loadSyncConfig).not.toHaveBeenCalled();
  });

  // The direction that matters most: a transient outage must go BACK on the queue, or the invoice
  // is lost from the books with nothing to say so.
  it("retries a transient QuickBooks failure", async () => {
    (h.ports.sync as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      err(externalService("quickbooks", "QuickBooks invoice create failed", true)),
    );
    expect((await h.handler.handle(event(), CTX)).ok).toBe(false);
  });

  // And the other direction: a refusal the shop has to act on is already in the sync log with an
  // actionable code, and re-running would not fix it.
  it("does not retry a refusal the shop has to fix", async () => {
    (h.ports.sync as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      err(externalService("quickbooks", "no QuickBooks item is chosen", false)),
    );
    expect((await h.handler.handle(event(), CTX)).ok).toBe(true);
  });

  it("retries when the token refresh itself was transient", async () => {
    (h.ports.access as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      err(externalService("quickbooks", "token refresh failed", true)),
    );
    expect((await h.handler.handle(event(), CTX)).ok).toBe(false);
  });

  it("gives up when the connection is dead — waiting cannot reconnect it", async () => {
    (h.ports.access as ReturnType<typeof vi.fn>).mockResolvedValueOnce(err(notFound("connection")));
    const r = await h.handler.handle(event(), CTX);
    expect(r.ok).toBe(true);
    expect(h.ports.sync).not.toHaveBeenCalled();
  });

  it("gives up on an invoice that has since been deleted", async () => {
    (h.ports.load as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const r = await h.handler.handle(event(), CTX);
    expect(r.ok).toBe(true);
    expect(h.ports.sync).not.toHaveBeenCalled();
  });
});
