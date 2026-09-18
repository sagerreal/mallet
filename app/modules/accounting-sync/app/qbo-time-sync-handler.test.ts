import { describe, it, expect, vi } from "vitest";
import { ok, err, externalService, unauthorized, notFound } from "@mallet/shared/types";
import type { OutboxEvent, RelayHandlerContext } from "@mallet/shared/outbox";
import type { SyncableTimeEntry } from "../domain/time-activity-mapping";
import { QboTimeSyncHandler, type QboTimeSyncPorts } from "./qbo-time-sync-handler";

const T0 = new Date("2026-07-24T12:00:00.000Z");
const ctx = { tx: {}, orgId: "org-1" } as unknown as RelayHandlerContext;

const event = (payload: Record<string, unknown> = {}): OutboxEvent =>
  ({
    id: "evt-1",
    seq: 1,
    orgId: "org-1",
    name: "timeEntry.weekApproved",
    payload: { techUserId: "user-1", dates: ["2026-07-21"], approved: 2, ...payload },
    occurredAt: T0,
  }) as unknown as OutboxEvent;

const anEntry: SyncableTimeEntry = {
  id: "te-1",
  techUserId: "user-1",
  workDate: "2026-07-21",
  kind: "job",
  startTime: "08:00",
  endTime: "16:00",
  note: "",
};

const harness = (over: Partial<QboTimeSyncPorts> = {}) => {
  const ports: QboTimeSyncPorts = {
    loadSyncConfig: vi.fn().mockResolvedValue({ enabled: true, defaultItemQboId: "42" }),
    access: vi.fn().mockResolvedValue(ok({ accessToken: "A", realmId: "913035" })),
    loadEntries: vi.fn().mockResolvedValue([anEntry]),
    sync: vi.fn().mockResolvedValue(ok({ sent: 1, skipped: 0, failed: 0 })),
    markSynced: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  return { ports, handler: new QboTimeSyncHandler(ports, { now: () => T0 }) };
};

describe("the happy path", () => {
  it("pushes the approved entries and stamps lastSyncAt", async () => {
    const h = harness();
    const res = await h.handler.handle(event(), ctx);

    expect(res.ok).toBe(true);
    expect(h.ports.sync).toHaveBeenCalled();
    expect(h.ports.markSynced).toHaveBeenCalledWith(ctx, T0);
  });

  it("passes the chosen service item through to the sync", async () => {
    const h = harness();
    await h.handler.handle(event(), ctx);
    expect(h.ports.sync).toHaveBeenCalledWith(ctx, "user-1", [anEntry], "42", expect.anything());
  });

  it("does not stamp lastSyncAt when nothing was actually sent", async () => {
    const h = harness({ sync: vi.fn().mockResolvedValue(ok({ sent: 0, skipped: 1, failed: 0 })) });
    await h.handler.handle(event(), ctx);
    expect(h.ports.markSynced).not.toHaveBeenCalled();
  });
});

describe("ordinary states that are not failures", () => {
  it("does nothing when QuickBooks isn't connected", async () => {
    const h = harness({ loadSyncConfig: vi.fn().mockResolvedValue(null) });
    const res = await h.handler.handle(event(), ctx);

    expect(res.ok).toBe(true);
    expect(h.ports.sync).not.toHaveBeenCalled();
  });

  // Connecting must never silently start writing to a shop's books.
  it("does nothing when the shop hasn't switched the push on", async () => {
    const h = harness({
      loadSyncConfig: vi.fn().mockResolvedValue({ enabled: false, defaultItemQboId: "42" }),
    });
    const res = await h.handler.handle(event(), ctx);

    expect(res.ok).toBe(true);
    expect(h.ports.access).not.toHaveBeenCalled();
  });

  it("does nothing when there are no entries to send", async () => {
    const h = harness({ loadEntries: vi.fn().mockResolvedValue([]) });
    const res = await h.handler.handle(event(), ctx);

    expect(res.ok).toBe(true);
    expect(h.ports.sync).not.toHaveBeenCalled();
  });
});

describe("retry vs terminal — the relay disposition contract", () => {
  it("RETRIES a transient QuickBooks outage", async () => {
    const h = harness({
      access: vi.fn().mockResolvedValue(err(externalService("quickbooks", "503", true))),
    });
    const res = await h.handler.handle(event(), ctx);

    expect(res.ok).toBe(false);
    if (!res.ok && res.error.kind === "external_service") expect(res.error.retryable).toBe(true);
  });

  it("does NOT retry a connection that needs re-authorising — spinning can't fix it", async () => {
    const h = harness({ access: vi.fn().mockResolvedValue(err(unauthorized("reconnect"))) });
    const res = await h.handler.handle(event(), ctx);
    expect(res.ok).toBe(true);
  });

  it("does NOT retry when the connection is simply missing", async () => {
    const h = harness({ access: vi.fn().mockResolvedValue(err(notFound("not connected"))) });
    const res = await h.handler.handle(event(), ctx);
    expect(res.ok).toBe(true);
  });

  it("retries a retryable sync failure", async () => {
    const h = harness({
      sync: vi.fn().mockResolvedValue(err(externalService("quickbooks", "500", true))),
    });
    const res = await h.handler.handle(event(), ctx);
    expect(res.ok).toBe(false);
  });

  it("does NOT retry per-entry failures — they are already logged with actionable codes", async () => {
    const h = harness({ sync: vi.fn().mockResolvedValue(err(unauthorized("dead token"))) });
    const res = await h.handler.handle(event(), ctx);
    expect(res.ok).toBe(true);
  });
});

describe("malformed events are terminal, never retried", () => {
  it.each([
    ["no techUserId", { techUserId: undefined }],
    ["empty dates", { dates: [] }],
    ["dates not an array", { dates: "2026-07-21" }],
  ])("drops an event with %s", async (_label, payload) => {
    const h = harness();
    const res = await h.handler.handle(event(payload), ctx);

    expect(res.ok).toBe(true);
    expect(h.ports.loadSyncConfig).not.toHaveBeenCalled();
  });
});
