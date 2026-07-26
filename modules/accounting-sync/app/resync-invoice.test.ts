import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResyncInvoice } from "./resync-invoice";
import type { QboApiGateway, QboAccess } from "../domain/qbo-api-gateway";
import type { QboEntityLinkRepository, QboSyncLogRepository } from "../domain/qbo-sync-repositories";
import type { SyncableInvoice } from "../domain/invoice-mapping";
import { ok, err, externalService } from "@mallet/shared/types";

const ORG = "org-1";
const ACCESS = { accessToken: "t", realmId: "9130" } as unknown as QboAccess;
const CUSTOMER = "qbo-cust-3";

const invoice: SyncableInvoice = {
  id: "inv-1",
  num: "INV-1001",
  title: "Water heater",
  totalCents: 120_000,
  taxCents: 9_661,
  sentAt: new Date(2026, 6, 25),
  dueAt: null,
};

const link = {
  entityType: "invoice" as const,
  malletId: "inv-1",
  qboId: "qbo-inv-9",
  qboEntityKind: null,
  displayName: "INV-1001",
};

const build = () => {
  const api = {
    readInvoiceToken: vi.fn(async () => ok("3")),
    updateInvoice: vi.fn(async () => ok(undefined)),
    voidInvoice: vi.fn(async () => ok(undefined)),
  } as unknown as QboApiGateway;
  const links = { find: vi.fn(async () => link) } as unknown as QboEntityLinkRepository;
  const syncLog = { record: vi.fn(async () => {}) } as unknown as QboSyncLogRepository;
  return { api, links, syncLog, use: new ResyncInvoice(api, links, syncLog, { now: () => new Date(2026, 6, 26) }) };
};

let h: ReturnType<typeof build>;
beforeEach(() => { h = build(); });

describe("ResyncInvoice.update", () => {
  it("restates the invoice in QuickBooks with the current SyncToken", async () => {
    const r = await h.use.update(invoice, CUSTOMER, "14", ACCESS, ORG);
    expect(r.ok && r.value.outcome).toBe("updated");
    const [, qboId, token, input] = (h.api.updateInvoice as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(qboId).toBe("qbo-inv-9");
    expect(token).toBe("3");
    // Pre-tax again, same as the create path — QuickBooks re-adds the tax.
    expect(input).toMatchObject({ netAmount: 1103.39, totalTax: 96.61 });
  });

  /**
   * The ordinary case, not a fault: the shop had invoice sync off when this was sent, or is
   * editing a draft. Reporting a failure would fill the activity screen with rows nobody can act
   * on.
   */
  it("is a silent no-op for an invoice that was never synced", async () => {
    (h.links.find as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const r = await h.use.update(invoice, CUSTOMER, "14", ACCESS, ORG);
    expect(r.ok && r.value.outcome).toBe("not_synced");
    expect(h.api.readInvoiceToken).not.toHaveBeenCalled();
    expect(h.syncLog.record).not.toHaveBeenCalled();
  });

  // Recreating it would resurrect something a bookkeeper removed on purpose.
  it("stops rather than recreating an invoice deleted inside QuickBooks", async () => {
    (h.api.readInvoiceToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(null));
    const r = await h.use.update(invoice, CUSTOMER, "14", ACCESS, ORG);
    expect(r.ok && r.value.outcome).toBe("gone_from_quickbooks");
    expect(h.api.updateInvoice).not.toHaveBeenCalled();
  });

  it("refuses when the customer link has been removed by hand", async () => {
    const r = await h.use.update(invoice, null, "14", ACCESS, ORG);
    expect(r.ok).toBe(false);
    expect(h.api.updateInvoice).not.toHaveBeenCalled();
    expect(h.syncLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "customer_not_linked" }),
    );
  });

  it("refuses an invoice that can no longer be mapped", async () => {
    const r = await h.use.update({ ...invoice, totalCents: 0, taxCents: 0 }, CUSTOMER, "14", ACCESS, ORG);
    expect(r.ok).toBe(false);
    expect(h.api.updateInvoice).not.toHaveBeenCalled();
  });

  it("surfaces a stale-token refusal instead of retrying blind", async () => {
    (h.api.updateInvoice as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      err(externalService("quickbooks", "Stale Object Error", false)),
    );
    const r = await h.use.update(invoice, CUSTOMER, "14", ACCESS, ORG);
    expect(r.ok).toBe(false);
    expect(h.syncLog.record).toHaveBeenCalled();
  });
});

describe("ResyncInvoice.void", () => {
  it("voids rather than deletes", async () => {
    const r = await h.use.void("inv-1", ACCESS, ORG);
    expect(r.ok && r.value.outcome).toBe("voided");
    expect(h.api.voidInvoice).toHaveBeenCalledWith(ACCESS, "qbo-inv-9", "3");
  });

  it("is a no-op for an invoice that was never synced", async () => {
    (h.links.find as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const r = await h.use.void("inv-1", ACCESS, ORG);
    expect(r.ok && r.value.outcome).toBe("not_synced");
    expect(h.api.voidInvoice).not.toHaveBeenCalled();
  });

  // Already gone is the desired end state, reached another way — not a failure.
  it("accepts an invoice already removed inside QuickBooks", async () => {
    (h.api.readInvoiceToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(null));
    const r = await h.use.void("inv-1", ACCESS, ORG);
    expect(r.ok && r.value.outcome).toBe("gone_from_quickbooks");
    expect(h.syncLog.record).not.toHaveBeenCalled();
  });

  /**
   * QuickBooks will not void an invoice with a payment applied. That needs a person, so it is
   * logged with its reason rather than retried into a wall.
   */
  it("records the refusal when a payment is attached", async () => {
    (h.api.voidInvoice as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      err(externalService("quickbooks", "Object Has Payments Applied", false)),
    );
    const r = await h.use.void("inv-1", ACCESS, ORG);
    expect(r.ok).toBe(false);
    expect(h.syncLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "invoice", status: "failed" }),
    );
  });
});
