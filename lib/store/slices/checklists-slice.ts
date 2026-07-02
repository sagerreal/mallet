/**
 * lib/store/slices/checklists-slice.ts
 * Checklist templates (job "before you leave" + scope "visit checklist").
 * Seeded with a couple of defaults; the office manages them via openStandards
 * and attaches one per job/estimate. Immutable updates only.
 */

import type { StateCreator } from "zustand";
import type { Checklist, ChecklistItem } from "../types";

let _nextChkId = 5000;
let _nextItemId = 5500;

function item(text: string, type: ChecklistItem["type"] = "check", required = false): ChecklistItem {
  return { id: ++_nextItemId, text, type, required };
}

const SEED_CHECKLISTS: Checklist[] = [
  {
    id: ++_nextChkId,
    name: "Water heater — before you leave",
    trade: "Plumbing",
    stage: "job",
    match: ["water heater", "tankless"],
    items: [
      item("Photo of the finished install", "photo", true),
      item("Test T&P relief valve", "check", true),
      item("Check all connections for leaks", "check", true),
      item("Haul away the old unit", "check", false),
    ],
  },
  {
    id: ++_nextChkId,
    name: "Estimate visit — what to capture",
    trade: "General",
    stage: "scope",
    match: [],
    items: [
      item("Photo of the problem area", "photo", true),
      item("Model / serial number", "check", false),
      item("Access & parking notes", "check", false),
    ],
  },
];

export interface ChecklistsSlice {
  checklists: Checklist[];
  addChecklist: (name: string, stage: Checklist["stage"]) => Checklist;
  deleteChecklist: (id: number) => void;
  addChecklistItem: (checklistId: number, text: string, type?: ChecklistItem["type"]) => void;
  deleteChecklistItem: (checklistId: number, itemId: number) => void;
  toggleItemRequired: (checklistId: number, itemId: number) => void;
}

export const createChecklistsSlice: StateCreator<ChecklistsSlice, [], [], ChecklistsSlice> = (set) => ({
  checklists: SEED_CHECKLISTS,

  addChecklist: (name, stage) => {
    const chk: Checklist = {
      id: ++_nextChkId,
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
        c.id === checklistId ? { ...c, items: [...c.items, item(text, type)] } : c
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
