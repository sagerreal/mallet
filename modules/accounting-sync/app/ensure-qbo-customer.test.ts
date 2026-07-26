import { describe, it, expect, vi, beforeEach } from "vitest";
import { EnsureQboCustomer } from "./ensure-qbo-customer";
import type { QboApiGateway, QboAccess } from "../domain/qbo-api-gateway";
import type { QboEntityLinkRepository, QboSyncLogRepository } from "../domain/qbo-sync-repositories";
import type { SyncableCustomer } from "../domain/customer-mapping";
import { ok, err, externalService } from "@mallet/shared/types";

const ORG = "org-1";
const ACCESS = { accessToken: "tok", realmId: "9130" } as unknown as QboAccess;
const NOW = new Date("2026-07-26T12:00:00Z");

const customer = (over: Partial<SyncableCustomer> = {}): SyncableCustomer => ({
  id: "lead-1",
  name: "Dave's Plumbing",
  email: "dave@example.com",
  phone: "555-0100",
  address: "12 Mill Lane, Springfield",
  ...over,
});

const build = () => {
  const api = {
    findCustomerByEmail: vi.fn(async () => ok(null)),
    findCustomerByName: vi.fn(async () => ok(null)),
    createCustomer: vi.fn(async () => ok({ id: "qbo-99", displayName: "Dave's Plumbing" })),
  } as unknown as QboApiGateway;
  const links = { find: vi.fn(async () => null), save: vi.fn(async () => {}) } as unknown as QboEntityLinkRepository;
  const syncLog = { record: vi.fn(async () => {}) } as unknown as QboSyncLogRepository;
  return {
    api,
    links,
    syncLog,
    use: new EnsureQboCustomer(api, links, syncLog, { now: () => NOW }),
  };
};

let h: ReturnType<typeof build>;
beforeEach(() => {
  h = build();
});

describe("EnsureQboCustomer — the order of evidence", () => {
  /**
   * A shop that corrected a match by hand must not have it silently overridden on the next
   * invoice, so an existing link is never re-examined — and costs no API call at all.
   */
  it("uses an existing link without asking QuickBooks anything", async () => {
    (h.links.find as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      entityType: "customer",
      malletId: "lead-1",
      qboId: "qbo-7",
      qboEntityKind: null,
      displayName: "Dave's Plumbing",
    });
    const r = await h.use.exec(customer(), ACCESS, ORG);
    expect(r.ok && r.value).toEqual({ qboId: "qbo-7", via: "already_linked" });
    expect(h.api.findCustomerByEmail).not.toHaveBeenCalled();
    expect(h.api.createCustomer).not.toHaveBeenCalled();
  });

  it("matches on exact email before anything else, and links it", async () => {
    (h.api.findCustomerByEmail as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      ok({ id: "qbo-3", displayName: "Dave Plumbing Co" }),
    );
    const r = await h.use.exec(customer(), ACCESS, ORG);
    expect(r.ok && r.value.via).toBe("matched_email");
    expect(h.api.findCustomerByName).not.toHaveBeenCalled();
    expect(h.api.createCustomer).not.toHaveBeenCalled();
    // The QuickBooks name is stored, not ours — the link should read as what QBO actually holds.
    expect(h.links.save).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "customer", qboId: "qbo-3", displayName: "Dave Plumbing Co" }),
    );
  });

  it("falls back to an exact name match", async () => {
    (h.api.findCustomerByName as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      ok({ id: "qbo-4", displayName: "Dave's Plumbing" }),
    );
    const r = await h.use.exec(customer(), ACCESS, ORG);
    expect(r.ok && r.value.via).toBe("matched_name");
    expect(h.api.createCustomer).not.toHaveBeenCalled();
  });

  it("skips the email lookup entirely when there is no email", async () => {
    await h.use.exec(customer({ email: null }), ACCESS, ORG);
    expect(h.api.findCustomerByEmail).not.toHaveBeenCalled();
    expect(h.api.findCustomerByName).toHaveBeenCalled();
  });

  it("creates only when nothing matched, and links the new id", async () => {
    const r = await h.use.exec(customer(), ACCESS, ORG);
    expect(r.ok && r.value).toEqual({ qboId: "qbo-99", via: "created" });
    expect(h.links.save).toHaveBeenCalledWith(
      expect.objectContaining({ qboId: "qbo-99", qboEntityKind: null }),
    );
  });
});

describe("EnsureQboCustomer — failures", () => {
  /**
   * QuickBooks requires DisplayName to be unique per company, so a create can lose a race to
   * somebody else. Re-reading is the honest recovery: the record exists, so link to it rather than
   * reporting a failure the shop cannot act on.
   */
  it("links to the winner when a create loses a name race", async () => {
    (h.api.createCustomer as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      err(externalService("quickbooks", "Duplicate Name Exists Error", false)),
    );
    (h.api.findCustomerByName as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok({ id: "qbo-8", displayName: "Dave's Plumbing" }));

    const r = await h.use.exec(customer(), ACCESS, ORG);
    expect(r.ok && r.value).toEqual({ qboId: "qbo-8", via: "matched_name" });
  });

  it("reports a create failure that was not a race", async () => {
    (h.api.createCustomer as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      err(externalService("quickbooks", "QuickBooks customer create failed", true)),
    );
    const r = await h.use.exec(customer(), ACCESS, ORG);
    expect(r.ok).toBe(false);
    expect(h.links.save).not.toHaveBeenCalled();
    expect(h.syncLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "customer", status: "failed" }),
    );
  });

  it("refuses a customer with no name, and logs why", async () => {
    const r = await h.use.exec(customer({ name: "   " }), ACCESS, ORG);
    expect(r.ok).toBe(false);
    expect(h.api.findCustomerByEmail).not.toHaveBeenCalled();
    expect(h.syncLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", errorCode: "customer_has_no_name" }),
    );
  });

  it("does not link when a lookup itself failed — an outage is not an absence", async () => {
    (h.api.findCustomerByEmail as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      err(externalService("quickbooks", "QuickBooks customer lookup by email failed", true)),
    );
    const r = await h.use.exec(customer(), ACCESS, ORG);
    expect(r.ok).toBe(false);
    // Crucially: it must NOT fall through to creating a duplicate because the search errored.
    expect(h.api.createCustomer).not.toHaveBeenCalled();
    expect(h.links.save).not.toHaveBeenCalled();
  });

  it("records a success in the sync log so the activity screen can show it", async () => {
    await h.use.exec(customer(), ACCESS, ORG);
    expect(h.syncLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "customer", status: "succeeded", qboId: "qbo-99" }),
    );
  });
});
