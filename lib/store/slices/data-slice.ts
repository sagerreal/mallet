/**
 * lib/store/slices/data-slice.ts
 * Reference data seeded from sample: companies, estimates, jobs, invoices, techs, users, brand.
 * Companies/techs/brand stay read-only for now; users are mutable from Settings
 * (role changes, remove, invite) via immutable spread actions.
 */

import type { StateCreator } from "zustand";
import type { Company, Tech, User, Brand } from "../types";
import {
  SAMPLE_COMPANIES,
  SAMPLE_TECHS,
  SAMPLE_USERS,
  SAMPLE_BRAND,
} from "@/lib/prototype-sample";

// New invited users continue past the sample ids.
let _nextUserId = 1000;

export interface UserDraft {
  name: string;
  email: string;
  mobile: string;
  role: string;
}

export interface DataSlice {
  companies: Company[];
  techs: Tech[];
  users: User[];
  brand: Brand;

  updateUserRole: (id: number, role: string) => void;
  removeUser: (id: number) => void;
  inviteUser: (draft: UserDraft) => void;
}

export const createDataSlice: StateCreator<DataSlice, [], [], DataSlice> = (set) => ({
  companies: SAMPLE_COMPANIES.map((c) => ({ ...c })),
  techs: SAMPLE_TECHS.map((t) => ({ ...t })),
  users: SAMPLE_USERS.map((u) => ({ ...u })),
  brand: { ...SAMPLE_BRAND },

  updateUserRole: (id, role) =>
    set((s) => ({
      users: s.users.map((u) => (u.id === id ? { ...u, role } : u)),
    })),

  removeUser: (id) =>
    set((s) => ({ users: s.users.filter((u) => u.id !== id) })),

  inviteUser: (draft) => {
    const name = draft.name.trim();
    const email = draft.email.trim();
    if (!name || !email) return;
    const newUser: User = {
      id: ++_nextUserId,
      name,
      email,
      role: draft.role || "office",
      mobile: draft.mobile.trim(),
      mobileVerified: false,
    };
    set((s) => ({ users: [...s.users, newUser] }));
  },
});
