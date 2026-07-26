import { describe, it, expect, vi, beforeEach } from "vitest";
import { SyncInvoice } from "./sync-invoice";
import type { EnsureQboCustomer } from "./ensure-qbo-customer";
import type { QboApiGateway, QboAccess } from "../domain/qbo-api-gateway";
import type { QboEntityLinkRepository, QboSyncLogRepository } from "../domain/qbo-sync-repositories";
import type { SyncableInvoice } from "../domain/invoice-mapping";
import type { SyncableCustomer } from "../domain/customer-mapping";
import { ok, err, externalService } from "@mallet/shared/types";

const ORG = "org-1";
const ACCESS = { accessToken: "tok", realmId: "9130" } as unknown as QboAccess;

const invoice: SyncableInvoice = {
  id: "inv-1",
  num: "INV-1001",
  title: "Water heater",
  totalCents: 110_000,
  taxCents: 8_855,
  sentAt: new Date(2026, 6, 25, 14, 0),
  dueAt: null,
};

const customer: SyncableCustomer = {
  id: "lead-1",
  name: "Dave's Plumbing",
  email: "dave@example.com",
  phone: null,
  address: null,
};

const build = () => {
  const api = { createInvoice: vi.fn(async () => ok({ id: "qbo-inv-9" })) } as unknown as QboApiGateway;
  const customers = {
    exec: vi.fn(async () => ok({ qboId: "qbo-cust-3", via: "created" as const })),
  } as unknown as EnsureQboCustomer;
  const links = { find: vi.fn(async () => null), save: vi.fn(async () => {}) } as unknown as QboEntityLinkRepository;
  const syncLog = {
    succeededIds: vi.fn(async () => new Set<string>()),
    record: vi.fn(async () => {}),
  } as unknown as QboSyncLogRepository;
  return {
    api,
    customers,
    links,
    syncLog,
    use: new SyncInvoice(api, customers, links, syncLog, { now: () => new Date(2026, 6, 26) }),
  };
};

let h: ReturnType<typeof build>;
beforeEach(() => {
  h = build();
});

const run = (over: Partial<Parameters<SyncInvoice["exec"]>[0]> = {}) =>
  h.use.exec({ invoice, customer, invoiceItemQboId: "14", ...over }, ACCESS, ORG);

describe("SyncInvoice", () => {
  it("pushes the invoice and links it", async () => {
    const r = await run();
    expect(r.ok && r.value).toEqual({ qboId: "qbo-inv-9", alreadySent: false });
    expect(h.links.save).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "invoice", malletId: "inv-1", qboId: "qbo-inv-9" }),
    );
    expect(h.syncLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "invoice", status: "succeeded" }),
    );
  });

  /**
   * The guard that protects real money. The relay is at-least-once, so redelivery is normal — and
   * a duplicate here is a second invoice in a shop's books, inflating revenue and their tax
   * liability on a document a customer will only ever pay once.
   */
  it("sends nothing when this invoice already reached QuickBooks", async () => {
    (h.syncLog.succeededIds as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Set(["inv-1"]));
    (h.links.find as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      entityType: "invoice",
      malletId: "inv-1",
      qboId: "qbo-inv-9",
      qboEntityKind: null,
      displayName: "INV-1001",
    });
    const r = await run();
    expect(r.ok && r.value).toEqual({ qboId: "qbo-inv-9", alreadySent: true });
    expect(h.api.createInvoice).not.toHaveBeenCalled();
    expect(h.customers.exec).not.toHaveBeenCalled();
  });

  /**
   * Ordering matters: a refusal we can see locally must not first create a customer record in
   * somebody's QuickBooks as a side effect of an invoice that was never going to send.
   */
  it("does not touch QuickBooks at all when the invoice cannot be mapped", async () => {
    const r = await run({ invoiceItemQboId: null });
    expect(r.ok).toBe(false);
    expect(h.customers.exec).not.toHaveBeenCalled();
    expect(h.api.createInvoice).not.toHaveBeenCalled();
    expect(h.syncLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", errorCode: "no_invoice_item" }),
    );
  });

  it("refuses a zero-amount invoice before reaching the network", async () => {
    const r = await h.use.exec(
      { invoice: { ...invoice, totalCents: 0, taxCents: 0 }, customer, invoiceItemQboId: "14" },
      ACCESS,
      ORG,
    );
    expect(r.ok).toBe(false);
    expect(h.api.createInvoice).not.toHaveBeenCalled();
  });

  it("aborts when the customer could not be readied, and says the invoice did not go", async () => {
    (h.customers.exec as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      err(externalService("quickbooks", "QuickBooks customer create failed", true)),
    );
    const r = await run();
    expect(r.ok).toBe(false);
    expect(h.api.createInvoice).not.toHaveBeenCalled();
    expect(h.links.save).not.toHaveBeenCalled();
    expect(h.syncLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "invoice",
        status: "failed",
        errorMessage: expect.stringContaining("customer not ready"),
      }),
    );
  });

  it("does not link an invoice whose create failed", async () => {
    (h.api.createInvoice as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      err(externalService("quickbooks", "QuickBooks invoice create failed", true)),
    );
    const r = await run();
    expect(r.ok).toBe(false);
    expect(h.links.save).not.toHaveBeenCalled();
  });

  it("files the invoice against the customer it just ensured", async () => {
    await run();
    const sent = (h.api.createInvoice as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(sent).toMatchObject({ customerId: "qbo-cust-3", netAmount: 1011.45, totalTax: 88.55 });
  });
});
