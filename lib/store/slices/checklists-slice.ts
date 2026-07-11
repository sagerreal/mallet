/**
 * lib/store/slices/checklists-slice.ts
 * Checklist templates (job "before you leave" + scope "visit checklist").
 * Seeded with a couple of defaults; the office manages them via openStandards
 * and attaches one per job/estimate. Immutable updates only.
 *
 * Ids are deterministic strings (chk-N / itm-N) for the store-only seed.
 * Persistence is Task 9; no network calls here.
 */

import type { StateCreator } from "zustand";
import type { Checklist, ChecklistItem } from "../types";

let _nextChkId = 5000;
let _nextItemId = 5500;

function mintChkId(): string {
  return `chk-${++_nextChkId}`;
}

function mintItemId(): string {
  return `itm-${++_nextItemId}`;
}

function item(
  text: string,
  type: ChecklistItem["type"] = "check",
  required = false,
  position = 0,
): ChecklistItem {
  return { id: mintItemId(), text, type, required, position };
}

const SEED_CHECKLISTS: Checklist[] = [
  {
    id: mintChkId(),
    name: "Water heater — before you leave",
    trade: "Plumbing",
    stage: "job",
    match: ["water heater", "tankless"],
    items: [
      item("Photo of the finished install", "photo", true, 0),
      item("Test T&P relief valve", "check", true, 1),
      item("Check all connections for leaks", "check", true, 2),
      item("Haul away the old unit", "check", false, 3),
    ],
  },
  {
    id: mintChkId(),
    name: "Estimate visit — what to capture",
    trade: "General",
    stage: "scope",
    match: [],
    items: [
      item("Photo of the problem area", "photo", true, 0),
      item("Model / serial number", "check", false, 1),
      item("Access & parking notes", "check", false, 2),
    ],
  },
];

export interface ChecklistsSlice {
  checklists: Checklist[];
  setChecklists: (checklists: Checklist[]) => void;
  addChecklist: (name: string, stage: Checklist["stage"]) => Checklist;
  deleteChecklist: (id: string) => void;
  addChecklistItem: (checklistId: string, text: string, type?: ChecklistItem["type"]) => void;
  deleteChecklistItem: (checklistId: string, itemId: string) => void;
  toggleItemRequired: (checklistId: string, itemId: string) => void;
}

export const createChecklistsSlice: StateCreator<ChecklistsSlice, [], [], ChecklistsSlice> = (set) => ({
  checklists: SEED_CHECKLISTS,

  setChecklists: (checklists) => set({ checklists }),

  addChecklist: (name, stage) => {
    const chk: Checklist = {
      id: mintChkId(),
      name: name.trim() || "New checklist",
      trade: "Custom",
      stage,
      match: [],
      items: [],
    };
    set((s) => ({ checklists: [...s.checklists, chk] }));
    return chk;
  },

  deleteChecklist: (id) =>
    set((s) => ({ checklists: s.checklists.filter((c) => c.id !== id) })),

  addChecklistItem: (checklistId, text, type = "check") =>
    set((s) => ({
      checklists: s.checklists.map((c) =>
        c.id === checklistId
          ? { ...c, items: [...c.items, item(text, type, false, c.items.length)] }
          : c
      ),
    })),

  deleteChecklistItem: (checklistId, itemId) =>
    set((s) => ({
      checklists: s.checklists.map((c) =>
        c.id === checklistId ? { ...c, items: c.items.filter((i) => i.id !== itemId) } : c
      ),
    })),

  toggleItemRequired: (checklistId, itemId) =>
    set((s) => ({
      checklists: s.checklists.map((c) =>
        c.id === checklistId
          ? { ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, required: !i.required } : i)) }
          : c
      ),
    })),
});
