/**
 * lib/store/slices/data-slice.ts
 * Read-only reference data seeded from sample: companies, estimates, jobs, invoices, techs, users, brand.
 * Mutability can be added per-slice later; for now Customers only needs leads.
 */

import type { StateCreator } from "zustand";
import type { Company, Tech, User, Brand } from "../types";
import {
  SAMPLE_COMPANIES,
  SAMPLE_TECHS,
  SAMPLE_USERS,
  SAMPLE_BRAND,
} from "@/lib/prototype-sample";

export interface DataSlice {
  companies: Company[];
  techs: Tech[];
  users: User[];
  brand: Brand;
}

export const createDataSlice: StateCreator<DataSlice, [], [], DataSlice> = () => ({
  companies: SAMPLE_COMPANIES.map((c) => ({ ...c })),
  techs: SAMPLE_TECHS.map((t) => ({ ...t })),
  users: SAMPLE_USERS.map((u) => ({ ...u })),
  brand: { ...SAMPLE_BRAND },
});
