/**
 * lib/store/slices/data-slice.ts
 * Reference data: companies (DB-backed via CompaniesHydrator), techs, brand.
 * Team/user management has moved to real DB queries via v1.identity.members.
 *
 * companies[] starts empty — CompaniesHydrator populates it from v1.companies.list.
 * techs[] starts empty — TechsHydrator populates it from the DB via setTechs.
 *
 * addCompany and updateCompany are OPTIMISTIC + PERSIST + RECONCILE, mirroring
 * the task/visit pattern in leads-slice.ts.
 */

import type { StateCreator } from "zustand";
import type { Company, Tech, Brand } from "../types";
import { trpcVanilla } from "@/lib/trpc/vanilla";

/** Generic brand shown until the org updates their profile. */
const DEFAULT_BRAND: Brand = {
  site: "",
  name: "My Business",
  initials: "MB",
  color: "#6B7280",
  tagline: "",
};

export interface DataSlice {
  companies: Company[];
  /** Starts empty; populated by TechsHydrator from the identity.members endpoint. */
  techs: Tech[];
  brand: Brand;

  /** Replace the companies slice — called by CompaniesHydrator on hydration. */
  setCompanies: (companies: Company[]) => void;
  /** Replace the techs slice — called by TechsHydrator on hydration. */
  setTechs: (techs: Tech[]) => void;

  /**
   * Optimistically prepend a new company, then persist via v1.companies.create.
   * Client-authored UUID is used as id so the returned DTO reconciles cleanly.
   *
   * Returns the optimistic Company AND a `persisted` promise that resolves after the
   * server confirms the row — callers that need the FK to exist before a dependent
   * insert must await `persisted` before proceeding.
   */
  addCompany: (name: string) => { company: Company; persisted: Promise<void> };

  /**
   * Optimistically patch the company, then persist via v1.companies.update.
   * On error, rolls back to the pre-mutation snapshot.
   */
  updateCompany: (id: string, patch: Partial<Company>) => void;
}

export const createDataSlice: StateCreator<DataSlice, [], [], DataSlice> = (set, get) => ({
  companies: [],
  techs: [],
  brand: { ...DEFAULT_BRAND },

  setCompanies: (companies) => set({ companies }),

  setTechs: (techs) => set({ techs }),

  addCompany: (name) => {
    const id = crypto.randomUUID();
    const company: Company = {
      id,
      name: name.trim() || "New company",
      sites: [],
      phone: "",
      email: "",
    };

    // Optimistic append — UI reflects the new company immediately.
    set((s) => ({ companies: [company, ...s.companies] }));

    // Persist and expose the promise so callers that need the FK committed can await it.
    const persisted = trpcVanilla.v1.companies.create
      .mutate({ id, name: company.name })
      .then((dto) => {
        // Reconcile: the server may normalise the name — apply its canonical version.
        set((s) => ({
          companies: s.companies.map((c) =>
            c.id === dto.id
              ? {
                  ...c,
                  name: dto.name,
                  phone: dto.phone ?? c.phone,
                  email: dto.email ?? c.email,
                  website: dto.website ?? c.website,
                  address: dto.address ?? c.address,
                  notes: dto.notes ?? c.notes,
                }
              : c,
          ),
        }));
      })
      .catch(() => {
        // Rollback on network failure.
        set((s) => ({ companies: s.companies.filter((c) => c.id !== id) }));
      }) as Promise<void>;

    return { company, persisted };
  },

  updateCompany: (id, patch) => {
    const snapshot = get().companies;
    set((s) => ({
      companies: s.companies.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));

    void trpcVanilla.v1.companies.update
      .mutate({
        companyId: id,
        name: patch.name,
        phone: patch.phone ?? null,
        email: patch.email ?? null,
        website: patch.website ?? null,
        address: patch.address ?? null,
        notes: patch.notes ?? null,
      })
      .then((dto) => {
        set((s) => ({
          companies: s.companies.map((c) =>
            c.id === dto.id
              ? {
                  ...c,
                  name: dto.name,
                  phone: dto.phone ?? "",
                  email: dto.email ?? "",
                  website: dto.website ?? undefined,
                  address: dto.address ?? undefined,
                  notes: dto.notes ?? undefined,
                }
              : c,
          ),
        }));
      })
      .catch(() => {
        // Rollback to the pre-mutation snapshot.
        set({ companies: snapshot });
      });
  },
});
