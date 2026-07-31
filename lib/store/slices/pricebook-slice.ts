/**
 * lib/store/slices/pricebook-slice.ts
 * The pricebook catalog (services + categories) — the pricing spine read by the
 * Composer, quote/invoice modals, and (later) the AI drafter. DB-backed:
 * PricebookHydrator seeds the slice from v1.pricebook.service.list +
 * category.list; every mutating action is optimistic → persist via
 * trpcVanilla → reconcile/rollback, mirroring addSource (settings-slice) and
 * addChecklist (checklists-slice). Immutable updates only.
 *
 * Replaces the old PbItem plumbing that used to live in settings-slice —
 * markup/laborRates/terms/booking stay there (unrelated to the catalog).
 */

import type { StateCreator } from "zustand";
import type { Service, Category, Material, ServiceMaterialLink } from "../types";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import {
  serviceDtoToStore,
  categoryDtoToStore,
  serviceCreatePayload,
  serviceUpdatePayload,
  categoryCreatePayload,
  seedResultDtoToStore,
  materialDtoToStore,
  materialCreatePayload,
  materialUpdatePayload,
  serviceMaterialDtoToStore,
  type AddServiceFields,
  type ServiceUpdateFields,
  type ServiceDTO,
  type CategoryDTO,
  type AddMaterialFields,
  type MaterialUpdateFields,
  type MaterialDTO,
} from "@/lib/store/pricebook-mapper";
import { reportWriteError } from "../write-error";

// Outcome of addService / addCategory so the UI can give feedback instead of silently
// swallowing a failure — mirrors AddSourceResult in settings-slice.
export type AddResult = { ok: true } | { ok: false; reason: "empty" | "duplicate" | "failed" };

/** Replace a service by id in a list with the server's canonical DTO; returns a new array. */
function reconcileService(list: Service[], id: string, dto: ServiceDTO): Service[] {
  const updated = serviceDtoToStore(dto);
  return list.map((s) => (s.id === id ? updated : s));
}

/** Replace a category by id in a list with the server's canonical DTO; returns a new array. */
function reconcileCategory(list: Category[], id: string, dto: CategoryDTO): Category[] {
  const updated = categoryDtoToStore(dto);
  return list.map((c) => (c.id === id ? updated : c));
}

/** Replace a material by id in a list with the server's canonical DTO; returns a new array. */
function reconcileMaterial(list: Material[], id: string, dto: MaterialDTO): Material[] {
  const updated = materialDtoToStore(dto);
  return list.map((m) => (m.id === id ? updated : m));
}

/**
 * Fold service-material links for ONE service into the flat list: drop whatever was
 * previously loaded for that service and replace with the fresh server set. This is what
 * loadServiceMaterials calls after a listForService fetch — replacing (not appending) means
 * a re-open of "Break into parts" can't accumulate duplicate/stale rows for the same service,
 * while links for every OTHER service already in the store are left untouched.
 */
function mergeServiceMaterialsForService(
  existing: ServiceMaterialLink[],
  serviceId: string,
  fresh: ServiceMaterialLink[],
): ServiceMaterialLink[] {
  const others = existing.filter((l) => l.serviceId !== serviceId);
  return [...others, ...fresh];
}

/**
 * Append any items not already present (by id) — returns a new array, or the same reference
 * when there is nothing to add. Used to fold v1.pricebook.seed's result into the existing
 * catalog: seeding never touches existing rows, and the response is empty when the org was
 * already seeded, so appending (never replacing) can't lose anything already loaded.
 */
function mergeNewById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const existingIds = new Set(existing.map((x) => x.id));
  const additions = incoming.filter((x) => !existingIds.has(x.id));
  return additions.length === 0 ? existing : [...existing, ...additions];
}

// Per-item write sequence — stale mutation responses must never clobber newer optimistic state.
const _svcWriteSeq = new Map<string, number>();
const _matWriteSeq = new Map<string, number>();

export interface PricebookSlice {
  services: Service[];
  categories: Category[];
  materials: Material[];
  /**
   * Flat list of service<->material joins (quantity), NOT keyed by service — a selector or
   * component filters by serviceId. Phase 2a hydrates this LAZILY per-service (see
   * loadServiceMaterials below), never eagerly for the whole catalog: there is no bulk
   * "listForServices" client endpoint yet, and eagerly fanning out one listForService call per
   * loaded service would be an N+1 on every pricebook page load for a catalog that mostly
   * doesn't need the parts breakdown open. The Level-2 "Break into parts" UI (Task 7) calls
   * loadServiceMaterials(serviceId) on demand when a service row is expanded.
   */
  serviceMaterials: ServiceMaterialLink[];

  /** Replace the whole slice — called by PricebookHydrator. */
  setPricebook: (snapshot: { services: Service[]; categories: Category[] }) => void;

  addService: (cmd: AddServiceFields) => Promise<AddResult>;
  /** Optimistic update; resolves {ok:false} (never rejects) after rolling back on a
   * failed persist — mirrors jobs-slice updateJob so interactive callers (the composer's
   * one-tap labor-hours chip) can surface the failure instead of losing it. */
  updateService: (id: string, fields: ServiceUpdateFields) => Promise<{ ok: boolean }>;
  archiveService: (id: string) => void;

  addCategory: (name: string, parentId?: string | null) => Promise<AddResult>;

  /** Task 8: one-click plumbing starter pack for an empty pricebook. Idempotent server-side
   * (v1.pricebook.seed no-ops if the org already has a service) — safe to call more than once. */
  seedPricebook: () => Promise<AddResult>;

  // ---- materials (Phase 2a) ----------------------------------------------

  /** Replace the loaded materials catalog — called by PricebookHydrator. */
  setMaterials: (materials: Material[]) => void;
  /** Replace the whole flat service-material list — used by tests/callers that already have
   * the full set; normal loading goes through loadServiceMaterials's per-service merge. */
  setServiceMaterials: (links: ServiceMaterialLink[]) => void;

  addMaterial: (cmd: AddMaterialFields) => Promise<AddResult>;
  updateMaterial: (id: string, fields: MaterialUpdateFields) => void;
  archiveMaterial: (id: string) => void;

  /** On-demand load of a single service's attached materials (Level-2 "Break into parts"
   * reveal). Merges into `serviceMaterials`, replacing whatever was previously loaded for
   * that serviceId so re-opening the reveal can't accumulate duplicates. */
  loadServiceMaterials: (serviceId: string) => Promise<void>;

  /** Optimistic attach; upserts quantity if the link already exists (matches the backend's
   * upsert-on-composite-pk semantics). */
  attachMaterial: (serviceId: string, materialId: string, quantity: number) => Promise<AddResult>;
  detachMaterial: (serviceId: string, materialId: string) => void;
}

export const createPricebookSlice: StateCreator<PricebookSlice, [], [], PricebookSlice> = (
  set,
  get,
) => ({
  // Starts empty — PricebookHydrator fills this from the DB.
  services: [],
  categories: [],
  materials: [],
  serviceMaterials: [],

  setPricebook: (snapshot) => set({ services: snapshot.services, categories: snapshot.categories }),

  // ---- services ---------------------------------------------------------

  addService: async (cmd) => {
    const name = cmd.name.trim();
    if (!name) return { ok: false, reason: "empty" };
    // Dedupe case-insensitively against the loaded catalog — a persisted duplicate would
    // also be rejected server-side (CreateServiceUseCase's conflict check), but checking
    // client-side avoids an optimistic row that is guaranteed to roll back.
    if (get().services.some((s) => s.name.trim().toLowerCase() === name.toLowerCase())) {
      return { ok: false, reason: "duplicate" };
    }

    const id = crypto.randomUUID();
    const optimistic: Service = {
      id,
      categoryId: cmd.categoryId ?? null,
      code: cmd.code ?? null,
      name,
      unitPrice: Math.max(0, cmd.unitPrice || 0),
      cost: Math.max(0, cmd.cost ?? 0),
      laborHours: cmd.laborHours ?? null,
      taxable: cmd.taxable ?? false,
      warrantyText: cmd.warrantyText ?? null,
      imageUrl: cmd.imageUrl ?? null,
      isAddon: cmd.isAddon ?? false,
      active: true,
      position: 0,
      measuredBy: cmd.measuredBy ?? null,
    };

    // Optimistic append — UI reflects the new service immediately.
    set((s) => ({ services: [...s.services, optimistic] }));

    try {
      const dto = await trpcVanilla.v1.pricebook.service.create.mutate(
        serviceCreatePayload(id, { ...cmd, name }),
      );
      // Reconcile: adopt the server's canonical values (position, normalised fields).
      set((s) => ({ services: reconcileService(s.services, id, dto) }));
      return { ok: true };
    } catch (e) {
      // Roll back the optimistic row and surface the failure — never silently swallow it.
      set((s) => ({ services: s.services.filter((x) => x.id !== id) }));
      reportWriteError("addService", e);
      return { ok: false, reason: "failed" };
    }
  },

  updateService: (id, fields) => {
    const snapshot = get().services;
    set((s) => ({
      services: s.services.map((svc) => (svc.id === id ? { ...svc, ...fields } : svc)),
    }));
    // LAST-WRITE-WINS: rapid edits (each keystroke / toggle is its own mutation) race,
    // and a STALE response reconciling the whole row snapped newer optimistic values
    // back for a beat — the Taxable switch visibly flip-flopped. Only the newest
    // in-flight write for a service may reconcile or roll back.
    const mySeq = (_svcWriteSeq.get(id) ?? 0) + 1;
    _svcWriteSeq.set(id, mySeq);
    // Returns the outcome ({ ok }) — never rejects — so interactive callers can
    // dismiss their UI only when the write actually stuck (no silent rollback).
    return trpcVanilla.v1.pricebook.service.update
      .mutate(serviceUpdatePayload(id, fields))
      .then((dto) => {
        if (_svcWriteSeq.get(id) === mySeq) {
          set((s) => ({ services: reconcileService(s.services, id, dto) }));
        }
        return { ok: true };
      })
      .catch((e: unknown) => {
        reportWriteError("updateService", e);
        if (_svcWriteSeq.get(id) === mySeq) set({ services: snapshot });
        return { ok: false };
      });
  },

  archiveService: (id) => {
    const snapshot = get().services;
    // Optimistic removal — archived services drop out of the active catalog immediately.
    set((s) => ({ services: s.services.filter((svc) => svc.id !== id) }));
    void trpcVanilla.v1.pricebook.service.archive
      .mutate({ serviceId: id })
      .catch((e: unknown) => {
        reportWriteError("archiveService", e);
        set({ services: snapshot });
      });
  },

  // ---- categories ---------------------------------------------------------

  addCategory: async (name, parentId) => {
    const nm = name.trim();
    if (!nm) return { ok: false, reason: "empty" };
    if (get().categories.some((c) => c.name.trim().toLowerCase() === nm.toLowerCase())) {
      return { ok: false, reason: "duplicate" };
    }

    const id = crypto.randomUUID();
    const optimistic: Category = { id, parentId: parentId ?? null, name: nm, sortOrder: 0 };
    set((s) => ({ categories: [...s.categories, optimistic] }));

    try {
      const dto = await trpcVanilla.v1.pricebook.category.create.mutate(
        categoryCreatePayload(id, nm, parentId),
      );
      set((s) => ({ categories: reconcileCategory(s.categories, id, dto) }));
      return { ok: true };
    } catch (e) {
      set((s) => ({ categories: s.categories.filter((x) => x.id !== id) }));
      reportWriteError("addCategory", e);
      return { ok: false, reason: "failed" };
    }
  },

  // ---- seed ---------------------------------------------------------------

  seedPricebook: async () => {
    try {
      const dto = await trpcVanilla.v1.pricebook.seed.mutate();
      const { services, categories } = seedResultDtoToStore(dto);
      // Append-only: never replace the loaded catalog. The server no-ops (empty arrays) if
      // the org was already seeded, so this can't clobber anything already in the store.
      set((s) => ({
        services: mergeNewById(s.services, services),
        categories: mergeNewById(s.categories, categories),
      }));
      return { ok: true };
    } catch (e) {
      reportWriteError("seedPricebook", e);
      return { ok: false, reason: "failed" };
    }
  },

  // ---- materials (Phase 2a) ------------------------------------------------

  setMaterials: (materials) => set({ materials }),
  setServiceMaterials: (links) => set({ serviceMaterials: links }),

  addMaterial: async (cmd) => {
    const name = cmd.name.trim();
    if (!name) return { ok: false, reason: "empty" };
    // Dedupe case-insensitively against the loaded catalog, mirroring addService — a
    // persisted duplicate would also be rejected server-side (CreateMaterialUseCase's
    // conflict check), but checking client-side avoids an optimistic row guaranteed to
    // roll back.
    if (get().materials.some((m) => m.name.trim().toLowerCase() === name.toLowerCase())) {
      return { ok: false, reason: "duplicate" };
    }

    const id = crypto.randomUUID();
    const optimistic: Material = {
      id,
      categoryId: cmd.categoryId ?? null,
      code: cmd.code ?? null,
      name,
      description: cmd.description ?? null,
      unitCost: Math.max(0, cmd.unitCost || 0),
      // Optimistic sell guess = cost (rule mode); the server's band-derived price
      // reconciles in on success — same adopt-the-DTO contract as every write.
      unitPrice: Math.max(0, cmd.unitCost || 0),
      pricingMode: "rule",
      unitOfMeasure: cmd.unitOfMeasure ?? "each",
      markupBps: cmd.markupBps ?? null,
      taxable: cmd.taxable ?? false,
      vendor: cmd.vendor ?? null,
      active: true,
      position: 0,
    };

    // Optimistic append — UI reflects the new material immediately.
    set((s) => ({ materials: [...s.materials, optimistic] }));

    try {
      const dto = await trpcVanilla.v1.pricebook.material.create.mutate(
        materialCreatePayload(id, { ...cmd, name }),
      );
      // Reconcile: adopt the server's canonical values (position, normalised fields).
      set((s) => ({ materials: reconcileMaterial(s.materials, id, dto) }));
      return { ok: true };
    } catch (e) {
      // Roll back the optimistic row and surface the failure — never silently swallow it.
      set((s) => ({ materials: s.materials.filter((x) => x.id !== id) }));
      reportWriteError("addMaterial", e);
      return { ok: false, reason: "failed" };
    }
  },

  updateMaterial: (id, fields) => {
    const snapshot = get().materials;
    set((s) => ({
      materials: s.materials.map((m) => (m.id === id ? { ...m, ...fields } : m)),
    }));
    // Last-write-wins — same stale-response race as updateService.
    const mySeq = (_matWriteSeq.get(id) ?? 0) + 1;
    _matWriteSeq.set(id, mySeq);
    void trpcVanilla.v1.pricebook.material.update
      .mutate(materialUpdatePayload(id, fields))
      .then((dto) => {
        if (_matWriteSeq.get(id) === mySeq) {
          set((s) => ({ materials: reconcileMaterial(s.materials, id, dto) }));
        }
      })
      .catch((e: unknown) => {
        reportWriteError("updateMaterial", e);
        if (_matWriteSeq.get(id) === mySeq) set({ materials: snapshot });
      });
  },

  archiveMaterial: (id) => {
    const snapshot = get().materials;
    // Optimistic removal — archived materials drop out of the active catalog immediately.
    set((s) => ({ materials: s.materials.filter((m) => m.id !== id) }));
    void trpcVanilla.v1.pricebook.material.archive
      .mutate({ materialId: id })
      .catch((e: unknown) => {
        reportWriteError("archiveMaterial", e);
        set({ materials: snapshot });
      });
  },

  // ---- service<->material joins (Phase 2a, lazy per-service) --------------

  loadServiceMaterials: async (serviceId) => {
    try {
      const dtos = await trpcVanilla.v1.pricebook.serviceMaterial.listForService.query({
        serviceId,
      });
      const fresh = dtos.map(serviceMaterialDtoToStore);
      set((s) => ({
        serviceMaterials: mergeServiceMaterialsForService(s.serviceMaterials, serviceId, fresh),
      }));
    } catch (e) {
      // No optimistic state to roll back (this is a read) — surface via dev log only, mirroring
      // the hydrator's isError logging convention.
      if (process.env.NODE_ENV !== "production") {
        console.warn("[loadServiceMaterials] load failed", e);
      }
    }
  },

  attachMaterial: async (serviceId, materialId, quantity) => {
    if (!(quantity > 0)) return { ok: false, reason: "empty" };

    const snapshot = get().serviceMaterials;
    const link: ServiceMaterialLink = { serviceId, materialId, quantity };
    const alreadyLinked = snapshot.some(
      (l) => l.serviceId === serviceId && l.materialId === materialId,
    );
    // Upsert semantics match the backend: attaching an already-attached material updates its
    // quantity rather than creating a second row.
    set((s) => ({
      serviceMaterials: alreadyLinked
        ? s.serviceMaterials.map((l) =>
            l.serviceId === serviceId && l.materialId === materialId ? link : l,
          )
        : [...s.serviceMaterials, link],
    }));

    try {
      await trpcVanilla.v1.pricebook.serviceMaterial.attach.mutate({
        serviceId,
        materialId,
        quantity,
      });
      return { ok: true };
    } catch (e) {
      // Roll back to the pre-attach snapshot and surface the failure — never silently swallow it.
      set({ serviceMaterials: snapshot });
      reportWriteError("attachMaterial", e);
      return { ok: false, reason: "failed" };
    }
  },

  detachMaterial: (serviceId, materialId) => {
    const snapshot = get().serviceMaterials;
    // Optimistic removal — the part drops out of the "Break into parts" list immediately.
    set((s) => ({
      serviceMaterials: s.serviceMaterials.filter(
        (l) => !(l.serviceId === serviceId && l.materialId === materialId),
      ),
    }));
    void trpcVanilla.v1.pricebook.serviceMaterial.detach
      .mutate({ serviceId, materialId })
      .catch((e: unknown) => {
        reportWriteError("detachMaterial", e);
        set({ serviceMaterials: snapshot });
      });
  },
});
