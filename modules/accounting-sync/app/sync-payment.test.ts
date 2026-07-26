import { describe, it, expect, vi, beforeEach } from "vitest";
import { SyncPayment } from "./sync-payment";
import type { EnsureQboCustomer } from "./ensure-qbo-customer";
import type { QboApiGateway, QboAccess } from "../domain/qbo-api-gateway";
import type { QboEntityLinkRepository, QboSyncLogRepository } from "../domain/qbo-sync-repositories";
import type { SyncablePayment } from "../domain/payment-mapping";
import type { SyncableCustomer } from "../domain/customer-mapping";
import { ok, err, externalService } from "@mallet/shared/types";

const ORG = "org-1";
const ACCESS = { accessToken: "tok", realmId: "9130" } as unknown as QboAccess;

const payment: SyncablePayment = {
  id: "pay-1",
  invoiceId: "inv-1",
  amountCents: 110_000,
  receivedAt: new Date(2026, 6, 26),
};
const customer: SyncableCustomer = {
  id: "lead-1",
  name: "Dave's Plumbing",
  email: null,
  phone: null,
  address: null,
};

const invoiceLink = {
  entityType: "invoice" as const,
  malletId: "inv-1",
  qboId: "qbo-inv-9",
  qboEntityKind: null,
  displayName: "INV-1001",
};

const build = () => {
  const api = { createPayment: vi.fn(async () => ok({ id: "qbo-pay-5" })) } as unknown as QboApiGateway;
  const customers = {
    exec: vi.fn(async () => ok({ qboId: "qbo-cust-3", via: "already_linked" as const })),
  } as unknown as EnsureQboCustomer;
  const links = {
    find: vi.fn(async (type: string) => (type === "invoice" ? invoiceLink : null)),
    save: vi.fn(async () => {}),
  } as unknown as QboEntityLinkRepository;
  const syncLog = {
    succeededIds: vi.fn(async () => new Set<string>()),
    record: vi.fn(async () => {}),
  } as unknown as QboSyncLogRepository;
  return {
    api, customers, links, syncLog,
    use: new SyncPayment(api, customers, links, syncLog, { now: () => new Date(2026, 6, 26) }),
  };
};

let h: ReturnType<typeof build>;
beforeEach(() => { h = build(); });

const run = () => h.use.exec({ payment, customer }, ACCESS, ORG);

describe("SyncPayment", () => {
  it("applies the payment against its QuickBooks invoice", async () => {
    const r = await run();
    expect(r.ok && r.value).toEqual({ qboId: "qbo-pay-5", alreadySent: false });
    const sent = (h.api.createPayment as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(sent).toMatchObject({ invoiceQboId: "qbo-inv-9", amount: 1100 });
  });

  /**
   * Deduped on the PAYMENT's id, not the invoice's. Two identical part-payments on one invoice are
   * ordinary; collapsing them would lose real money from the books.
   */
  it("does not send a payment that already reached QuickBooks", async () => {
    (h.syncLog.succeededIds as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Set(["pay-1"]));
    (h.links.find as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...invoiceLink, entityType: "payment", malletId: "pay-1", qboId: "qbo-pay-5",
    });
    const r = await run();
    expect(r.ok && r.value.alreadySent).toBe(true);
    expect(h.api.createPayment).not.toHaveBeenCalled();
  });

  it("dedupes on the payment id, so a second identical payment still sends", async () => {
    (h.syncLog.succeededIds as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Set<string>());
    const r = await h.use.exec({ payment: { ...payment, id: "pay-2" }, customer }, ACCESS, ORG);
    expect(r.ok && r.value.alreadySent).toBe(false);
    expect(h.api.createPayment).toHaveBeenCalled();
  });

  // Refusing beats filing an unapplied credit the shop has to reconcile by hand.
  it("refuses when the invoice is not in QuickBooks, without touching the network", async () => {
    (h.links.find as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await run();
    expect(r.ok).toBe(false);
    expect(h.api.createPayment).not.toHaveBeenCalled();
    expect(h.customers.exec).not.toHaveBeenCalled();
    expect(h.syncLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", errorCode: "invoice_not_in_quickbooks" }),
    );
  });

  it("does not link a payment whose create failed", async () => {
    (h.api.createPayment as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      err(externalService("quickbooks", "QuickBooks payment create failed", true)),
    );
    const r = await run();
    expect(r.ok).toBe(false);
    expect(h.links.save).not.toHaveBeenCalled();
  });

  it("records a success so the activity screen can show it", async () => {
    await run();
    expect(h.syncLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "payment", status: "succeeded", qboId: "qbo-pay-5" }),
    );
  });
});
