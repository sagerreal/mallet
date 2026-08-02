/**
 * lib/store/slices/assemblies-slice.ts
 * The org's estimating assemblies — recipe-priced scopes ("Driveway
 * replacement, 3-inch") read by the composer's Measure panel (assembly seeding)
 * and the pricebook's Assemblies card (dial editing). DB-backed:
 * AssembliesHydrator seeds from v1.assemblies.list; writes are optimistic →
 * trpcVanilla → reconcile from the returned DTO → rollback + reportWriteError
 * on failure (the updateService pattern, incl. last-write-wins sequencing for
 * rapid dial edits).
 *
 * Values stay in wire units (cents/bps/factors) — see assemblies-mapper.ts.
 */

import type { StateCreator } from "zustand";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { assemblyDtoToStore, type AssemblyView } from "@/lib/store/assemblies-mapper";
import { reportWriteError } from "../write-error";

// Per-assembly write sequence — a stale saveDial response must never clobber
// newer optimistic state (two quick dial edits race their reconciles).
const _asmWriteSeq = new Map<string, number>();

/** Patch one dial's currentRaw on one assembly, immutably. */
function patchDial(list: AssemblyView[], id: string, dialKey: string, rawValue: number): AssemblyView[] {
  return list.map((a) =>
    a.id === id
      ? {
          ...a,
          dials: a.dials.map((d) => (d.key === dialKey ? { ...d, currentRaw: rawValue } : d)),
        }
      : a,
  );
}

export interface AssembliesSlice {
  assemblies: AssemblyView[];
  /** Replace the loaded book — called by AssembliesHydrator. */
  setAssemblies: (assemblies: AssemblyView[]) => void;

  /**
   * Turn one dial (the editor's only write). Optimistically patches the dial's
   * displayed value; the reconcile adopts the server's full item — including
   * the recomputed config blob and, for a first edit of an untouched default,
   * the NEW ROW ID that replaces the "catalog:<key>" synthetic id. Resolves
   * { ok } (never rejects) so the editor can surface a failed save.
   */
  saveAssemblyDial: (id: string, dialKey: string, rawValue: number) => Promise<{ ok: boolean }>;

  /** Remove an assembly from the book (soft delete / catalog tombstone). */
  archiveAssembly: (id: string) => void;
}

export const createAssembliesSlice: StateCreator<AssembliesSlice, [], [], AssembliesSlice> = (
  set,
  get,
) => ({
  // Starts empty — AssembliesHydrator fills this from the DB.
  assemblies: [],

  setAssemblies: (assemblies) => set({ assemblies }),

  saveAssemblyDial: (id, dialKey, rawValue) => {
    const snapshot = get().assemblies;
    set((s) => ({ assemblies: patchDial(s.assemblies, id, dialKey, rawValue) }));
    const mySeq = (_asmWriteSeq.get(id) ?? 0) + 1;
    _asmWriteSeq.set(id, mySeq);
    return trpcVanilla.v1.assemblies.saveDial
      .mutate({ assemblyId: id, dialKey, rawValue })
      .then((dto) => {
        if (_asmWriteSeq.get(id) === mySeq) {
          // The response is the persisted ROW — its id replaces the synthetic
          // catalog id on first materialization, so match on either.
          set((s) => ({
            assemblies: s.assemblies.map((a) =>
              a.id === id || a.id === dto.id ? assemblyDtoToStore(dto) : a,
            ),
          }));
        }
        return { ok: true };
      })
      .catch((e: unknown) => {
        reportWriteError("saveAssemblyDial", e);
        if (_asmWriteSeq.get(id) === mySeq) set({ assemblies: snapshot });
        return { ok: false };
      });
  },

  archiveAssembly: (id) => {
    const snapshot = get().assemblies;
    set((s) => ({ assemblies: s.assemblies.filter((a) => a.id !== id) }));
    trpcVanilla.v1.assemblies.archive.mutate({ assemblyId: id }).catch((e: unknown) => {
      reportWriteError("archiveAssembly", e);
      set({ assemblies: snapshot });
    });
  },
});
