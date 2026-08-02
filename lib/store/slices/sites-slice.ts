/**
 * lib/store/slices/sites-slice.ts
 * Site captures (aerial takeoff — outdoor surfaces), job-scoped like
 * measurements-slice's roomsByJob. Hydrates lazily per job via
 * features/measurements/use-job-sites.ts, NOT the global hydrator config.
 *
 * addTracedSite is server-persisted-FIRST (mirrors scanRoom's rationale): the
 * working area of a traced surface is derived server-side from footprint +
 * pitch, so there is nothing honest to render before the mutation resolves —
 * no optimistic row, adopt the returned DTO.
 *
 * updateSite / archiveSite follow the standard optimistic → persist →
 * reconcile/rollback pattern; failures report through reportWriteError and
 * roll back (no silent failures).
 */

import type { StateCreator } from "zustand";
import type { SiteCard, SitePolygonShape } from "../types";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { siteCaptureDtoToStore } from "@/lib/store/measurements-mapper";
import { pitchCorrectedAreaPreview } from "@/lib/measure/aerial-geometry";
import { reportWriteError } from "../write-error";

export interface AddTracedSiteInput {
  readonly jobId: string;
  readonly name: string;
  readonly surface: "flat" | "pitched";
  readonly pitchRise?: number; // required when surface is "pitched"
  readonly polygon: SitePolygonShape;
  readonly footprintSqft: number;
  readonly perimeterLnft: number;
}

export interface UpdateSitePatch {
  readonly name?: string;
  readonly surface?: "flat" | "pitched";
  readonly pitchRise?: number;
}

export interface SitesSlice {
  sitesByJob: Record<string, SiteCard[]>;
  /** Replace one job's site captures — called by useJobSites on hydration. */
  setJobSites: (jobId: string, sites: SiteCard[]) => void;
  /**
   * Persists a traced surface server-side, then adopts the returned DTO
   * (server-derived working area). Throws (after reportWriteError) on failure —
   * callers surface the error inline.
   */
  addTracedSite: (input: AddTracedSiteInput) => Promise<SiteCard>;
  /** Rename / re-surface / re-pitch. Optimistic; reconciles from the server DTO. */
  updateSite: (jobId: string, captureId: string, patch: UpdateSitePatch) => void;
  /** Soft-archive. Optimistic remove; rolls back on failure. */
  archiveSite: (jobId: string, captureId: string) => void;
}

/** Optimistic shape of a patched site — the server's recompute reconciles it. */
function applyPatch(site: SiteCard, patch: UpdateSitePatch): SiteCard {
  const surface = patch.surface ?? site.surface;
  const pitchRise = surface === "flat" ? null : (patch.pitchRise ?? site.pitchRise);
  const areaSqft =
    site.footprintSqft !== null
      ? pitchCorrectedAreaPreview(site.footprintSqft, surface === "pitched" ? (pitchRise ?? 0) : 0)
      : site.areaSqft;
  return {
    ...site,
    name: patch.name ?? site.name,
    surface,
    pitchRise,
    areaSqft,
  };
}

export const createSitesSlice: StateCreator<SitesSlice, [], [], SitesSlice> = (set, get) => ({
  sitesByJob: {},

  setJobSites: (jobId, sites) =>
    set((s) => ({ sitesByJob: { ...s.sitesByJob, [jobId]: sites } })),

  addTracedSite: async (input) => {
    try {
      const dto = await trpcVanilla.v1.measurements.siteCreate.mutate({
        id: crypto.randomUUID(),
        jobId: input.jobId,
        name: input.name,
        source: "aerial_trace_v1",
        surface: input.surface,
        pitchRise: input.surface === "pitched" ? input.pitchRise : undefined,
        polygon: {
          vertices: input.polygon.vertices.map((v) => ({ lat: v.lat, lng: v.lng })),
          view: { ...input.polygon.view },
          // Roof edge classification rides in the polygon (v2 additive shape);
          // the server derives the per-class linears from it.
          ...(input.polygon.edgeClasses !== undefined
            ? { edgeClasses: [...input.polygon.edgeClasses] }
            : {}),
          ...(input.polygon.interiorLines !== undefined
            ? {
                interiorLines: input.polygon.interiorLines.map((l) => ({
                  a: { ...l.a },
                  b: { ...l.b },
                  cls: l.cls,
                })),
              }
            : {}),
        },
        footprintSqft: input.footprintSqft,
        perimeterLnft: input.perimeterLnft,
      });
      const site = siteCaptureDtoToStore(dto);

      // Server-persisted-first: adopt the DTO directly, no optimistic row.
      set((s) => ({
        sitesByJob: {
          ...s.sitesByJob,
          [input.jobId]: [...(s.sitesByJob[input.jobId] ?? []), site],
        },
      }));

      return site;
    } catch (err: unknown) {
      reportWriteError("addTracedSite", err);
      throw err instanceof Error ? err : new Error("addTracedSite failed");
    }
  },

  updateSite: (jobId, captureId, patch) => {
    const snapshot = get().sitesByJob[jobId] ?? [];

    // Optimistic: apply the patch locally (area preview mirrors the server formula).
    set((s) => ({
      sitesByJob: {
        ...s.sitesByJob,
        [jobId]: (s.sitesByJob[jobId] ?? []).map((c) =>
          c.id === captureId ? applyPatch(c, patch) : c,
        ),
      },
    }));

    trpcVanilla.v1.measurements.siteUpdate
      .mutate({
        captureId,
        name: patch.name,
        surface: patch.surface,
        // Never send a pitch alongside a flip to flat — the server rejects it.
        pitchRise: patch.surface === "flat" ? undefined : patch.pitchRise,
      })
      .then((dto) => {
        const reconciled = siteCaptureDtoToStore(dto);
        set((s) => ({
          sitesByJob: {
            ...s.sitesByJob,
            [jobId]: (s.sitesByJob[jobId] ?? []).map((c) => (c.id === captureId ? reconciled : c)),
          },
        }));
      })
      .catch((err: unknown) => {
        reportWriteError("updateSite", err);
        set((s) => ({ sitesByJob: { ...s.sitesByJob, [jobId]: snapshot } }));
      });
  },

  archiveSite: (jobId, captureId) => {
    const snapshot = get().sitesByJob[jobId] ?? [];

    // Optimistic remove.
    set((s) => ({
      sitesByJob: {
        ...s.sitesByJob,
        [jobId]: (s.sitesByJob[jobId] ?? []).filter((c) => c.id !== captureId),
      },
    }));

    trpcVanilla.v1.measurements.siteArchive.mutate({ captureId }).catch((err: unknown) => {
      reportWriteError("archiveSite", err);
      // Rollback: restore the pre-archive snapshot (order preserved).
      set((s) => ({ sitesByJob: { ...s.sitesByJob, [jobId]: snapshot } }));
    });
  },
});
