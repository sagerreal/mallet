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
import type { Service, Category } from "../types";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import {
  serviceDtoToStore,
  categoryDtoToStore,
  serviceCreatePayload,
  serviceUpdatePayload,
  categoryCreatePayload,
  type AddServiceFields,
  type ServiceUpdateFields,
  type ServiceDTO,
  type CategoryDTO,
} from "@/lib/store/pricebook-mapper";

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

export interface PricebookSlice {
  services: Service[];
  categories: Category[];

  /** Replace the whole slice — called by PricebookHydrator. */
  setPricebook: (snapshot: { services: Service[]; categories: Category[] }) => void;

  addService: (cmd: AddServiceFields) => Promise<AddResult>;
  updateService: (id: string, fields: ServiceUpdateFields) => void;
  archiveService: (id: string) => void;

  addCategory: (name: string, parentId?: string | null) => Promise<AddResult>;
}

export const createPricebookSlice: StateCreator<PricebookSlice, [], [], PricebookSlice> = (
  set,
  get,
) => ({
  // Starts empty — PricebookHydrator fills this from the DB.
  services: [],
  categories: [],

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
      if (process.env.NODE_ENV !== "production") console.warn("[addService] create failed", e);
      return { ok: false, reason: "failed" };
    }
  },

  updateService: (id, fields) => {
    const snapshot = get().services;
    set((s) => ({
      services: s.services.map((svc) => (svc.id === id ? { ...svc, ...fields } : svc)),
    }));
    void trpcVanilla.v1.pricebook.service.update
      .mutate(serviceUpdatePayload(id, fields))
      .then((dto) => {
        set((s) => ({ services: reconcileService(s.services, id, dto) }));
      })
      .catch((e: unknown) => {
        if (process.env.NODE_ENV !== "production") console.warn("[updateService] update failed", e);
        set({ services: snapshot });
      });
  },

  archiveService: (id) => {
    const snapshot = get().services;
    // Optimistic removal — archived services drop out of the active catalog immediately.
    set((s) => ({ services: s.services.filter((svc) => svc.id !== id) }));
    void trpcVanilla.v1.pricebook.service.archive
      .mutate({ serviceId: id })
      .catch((e: unknown) => {
        if (process.env.NODE_ENV !== "production") console.warn("[archiveService] archive failed", e);
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
      if (process.env.NODE_ENV !== "production") console.warn("[addCategory] create failed", e);
      return { ok: false, reason: "failed" };
    }
  },
});
