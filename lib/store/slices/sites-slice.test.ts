import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";
import { createSitesSlice, type SitesSlice } from "./sites-slice";
import type { SiteCard } from "../types";

const mutate = {
  siteCreate: vi.fn(),
  siteUpdate: vi.fn(),
  siteArchive: vi.fn(),
};

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      measurements: {
        siteCreate: { mutate: (...a: unknown[]) => mutate.siteCreate(...a) },
        siteUpdate: { mutate: (...a: unknown[]) => mutate.siteUpdate(...a) },
        siteArchive: { mutate: (...a: unknown[]) => mutate.siteArchive(...a) },
      },
    },
  },
}));

const reportWriteError = vi.fn();
vi.mock("../write-error", () => ({
  reportWriteError: (...a: unknown[]) => reportWriteError(...a),
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

const JOB = "job-1";

const polygon = {
  vertices: [
    { lat: 35.1, lng: -80.1 },
    { lat: 35.2, lng: -80.1 },
    { lat: 35.2, lng: -80.2 },
  ],
  view: { centerLat: 35.15, centerLng: -80.15, zoom: 20 },
};

const site = (overrides: Partial<SiteCard> = {}): SiteCard => ({
  id: "site-1",
  jobId: JOB,
  name: "Surface 1",
  source: "aerial_trace_v1",
  surface: "flat",
  pitchRise: null,
  areaSqft: 1240,
  footprintSqft: 1240,
  perimeterLnft: 142,
  polygon,
  createdAt: "2026-07-01T00:00:00.000Z",
  ...overrides,
});

/** DTO shape as the server returns it (same fields, server-derived area). */
const dto = (overrides: Partial<SiteCard> = {}) => ({ ...site(), ...overrides });

describe("sitesSlice", () => {
  let store: StoreApi<SitesSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<SitesSlice>((set, get, api) => createSitesSlice(set, get, api));
  });

  it("starts empty", () => {
    expect(store.getState().sitesByJob).toEqual({});
  });

  describe("setJobSites", () => {
    it("replaces the slice for that job only", () => {
      store.getState().setJobSites(JOB, [site()]);
      store.getState().setJobSites("job-2", [site({ id: "site-2", jobId: "job-2" })]);
      expect(store.getState().sitesByJob[JOB]).toHaveLength(1);
      expect(store.getState().sitesByJob["job-2"]).toHaveLength(1);

      store.getState().setJobSites(JOB, [site({ id: "site-3" })]);
      expect(store.getState().sitesByJob[JOB]?.map((s) => s.id)).toEqual(["site-3"]);
    });
  });

  describe("addTracedSite", () => {
    it("persists first, then adopts the server DTO (server-derived area)", async () => {
      mutate.siteCreate.mockResolvedValue(dto({ surface: "pitched", pitchRise: 6, areaSqft: 1386.36 }));

      const created = await store.getState().addTracedSite({
        jobId: JOB,
        name: "Surface 1",
        surface: "pitched",
        pitchRise: 6,
        polygon,
        footprintSqft: 1240,
        perimeterLnft: 142,
      });

      // Adopted, not re-derived: the store holds the SERVER's number.
      expect(created.areaSqft).toBe(1386.36);
      expect(store.getState().sitesByJob[JOB]).toHaveLength(1);
      const sent = mutate.siteCreate.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(sent.source).toBe("aerial_trace_v1");
      expect(sent.pitchRise).toBe(6);
      // No client-computed working area on the wire for a traced capture.
      expect(sent.areaSqft).toBeUndefined();
    });

    it("does not send a pitch for a flat surface", async () => {
      mutate.siteCreate.mockResolvedValue(dto());
      await store.getState().addTracedSite({
        jobId: JOB,
        name: "Surface 1",
        surface: "flat",
        polygon,
        footprintSqft: 1240,
        perimeterLnft: 142,
      });
      const sent = mutate.siteCreate.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(sent.pitchRise).toBeUndefined();
    });

    it("throws and adopts nothing on failure", async () => {
      mutate.siteCreate.mockRejectedValue(new Error("boom"));
      await expect(
        store.getState().addTracedSite({
          jobId: JOB,
          name: "Surface 1",
          surface: "flat",
          polygon,
          footprintSqft: 1240,
          perimeterLnft: 142,
        }),
      ).rejects.toThrow("boom");
      expect(store.getState().sitesByJob[JOB]).toBeUndefined();
      expect(reportWriteError).toHaveBeenCalledWith("addTracedSite", expect.any(Error));
    });
  });

  describe("updateSite", () => {
    it("applies the patch optimistically with a pitch-corrected area preview", () => {
      mutate.siteUpdate.mockReturnValue(new Promise(() => undefined)); // never resolves
      store.getState().setJobSites(JOB, [site()]);

      store.getState().updateSite(JOB, "site-1", { surface: "pitched", pitchRise: 6 });

      const updated = store.getState().sitesByJob[JOB]?.[0];
      expect(updated?.surface).toBe("pitched");
      expect(updated?.pitchRise).toBe(6);
      // Preview mirrors the server formula: 1240 / cos(atan(6/12)).
      expect(updated?.areaSqft).toBeCloseTo(1386.36, 2);
    });

    it("reconciles with the server DTO on success", async () => {
      mutate.siteUpdate.mockResolvedValue(dto({ name: "Roof", surface: "pitched", pitchRise: 8, areaSqft: 1490.05 }));
      store.getState().setJobSites(JOB, [site()]);

      store.getState().updateSite(JOB, "site-1", { surface: "pitched", pitchRise: 8, name: "Roof" });
      await flush();

      const updated = store.getState().sitesByJob[JOB]?.[0];
      expect(updated?.name).toBe("Roof");
      expect(updated?.areaSqft).toBe(1490.05);
    });

    it("never sends a pitch alongside a flip to flat", async () => {
      mutate.siteUpdate.mockResolvedValue(dto());
      store.getState().setJobSites(JOB, [site({ surface: "pitched", pitchRise: 6 })]);

      store.getState().updateSite(JOB, "site-1", { surface: "flat" });
      await flush();

      const sent = mutate.siteUpdate.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(sent.surface).toBe("flat");
      expect(sent.pitchRise).toBeUndefined();
      // Optimistic state cleared the pitch too.
      // (reconciled from dto() which is flat/null)
      expect(store.getState().sitesByJob[JOB]?.[0]?.pitchRise).toBeNull();
    });

    it("rolls back on failure", async () => {
      mutate.siteUpdate.mockRejectedValue(new Error("nope"));
      store.getState().setJobSites(JOB, [site()]);

      store.getState().updateSite(JOB, "site-1", { name: "Roof" });
      expect(store.getState().sitesByJob[JOB]?.[0]?.name).toBe("Roof");
      await flush();

      expect(store.getState().sitesByJob[JOB]?.[0]?.name).toBe("Surface 1");
      expect(reportWriteError).toHaveBeenCalledWith("updateSite", expect.any(Error));
    });
  });

  describe("archiveSite", () => {
    it("removes optimistically and stays removed on success", async () => {
      mutate.siteArchive.mockResolvedValue({ ok: true });
      store.getState().setJobSites(JOB, [site()]);

      store.getState().archiveSite(JOB, "site-1");
      expect(store.getState().sitesByJob[JOB]).toHaveLength(0);
      await flush();
      expect(store.getState().sitesByJob[JOB]).toHaveLength(0);
    });

    it("rolls back on failure", async () => {
      mutate.siteArchive.mockRejectedValue(new Error("nope"));
      store.getState().setJobSites(JOB, [site()]);

      store.getState().archiveSite(JOB, "site-1");
      expect(store.getState().sitesByJob[JOB]).toHaveLength(0);
      await flush();

      expect(store.getState().sitesByJob[JOB]).toHaveLength(1);
      expect(reportWriteError).toHaveBeenCalledWith("archiveSite", expect.any(Error));
    });
  });
});
