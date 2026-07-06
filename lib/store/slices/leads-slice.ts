/**
 * lib/store/slices/leads-slice.ts
 * Lead data + actions seeded from prototype-sample.
 * All updates are immutable (spread patterns only).
 */

import type { StateCreator } from "zustand";
import type { Lead, LeadNote, Task, Visit } from "../types";
import {
  SAMPLE_LEADS,
  SAMPLE_TASKS,
} from "@/lib/prototype-sample";

// Seed from sample — cast acts.type to the LeadNote union (values match, SampleAct.type is loose string)
const SEED_LEADS: Lead[] = SAMPLE_LEADS.map((l) => ({
  ...l,
  acts: l.acts?.map((a) => ({ ...a, type: a.type as LeadNote["type"] })),
}));
const SEED_TASKS: Task[] = SAMPLE_TASKS.map((t) => ({ ...t }));

let _nextId = 100;
let _nextTaskId = 50;

function nextLeadId(): number {
  return ++_nextId;
}

function nextTaskId(): number {
  return ++_nextTaskId;
}

export interface LeadsSlice {
  leads: Lead[];
  tasks: Task[];

  addLead: (draft: Omit<Lead, "id" | "age" | "last" | "acts" | "evisits">) => Lead;
  updateLead: (id: number, patch: Partial<Lead>) => void;
  moveLeadStage: (id: number, stage: string) => void;
  addLeadNote: (id: number, note: Omit<LeadNote, "id">) => LeadNote;
  removeLeadNote: (id: number, noteId: string) => void;
  archiveLead: (id: number) => void;
  restoreLead: (id: number) => void;
  deleteLead: (id: number) => void;

  // Estimate-visit (evisit) placement on the schedule board.
  addEvisit: (leadId: number, draft: Omit<Visit, "id">) => Visit;
  updateEvisit: (leadId: number, visitId: number, patch: Partial<Visit>) => void;
  placeEvisit: (leadId: number, visitId: number, at: { techId: number; date: string; start: number }) => void;
  removeEvisit: (leadId: number, visitId: number) => void;

  taskDone: (id: number) => void;
  toggleTask: (id: number) => void;
  addTask: (draft: Omit<Task, "id" | "done">) => void;
}

export const createLeadsSlice: StateCreator<LeadsSlice, [], [], LeadsSlice> = (set, get) => ({
  leads: SEED_LEADS,
  tasks: SEED_TASKS,

  addLead: (draft) => {
    const newLead: Lead = {
      ...draft,
      id: nextLeadId(),
      age: 0,
      last: "Just added",
      acts: [],
      evisits: [],
    };
    set((s) => ({ leads: [newLead, ...s.leads] }));
    return newLead;
  },

  updateLead: (id, patch) =>
    set((s) => ({
      leads: s.leads.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    })),

  moveLeadStage: (id, stage) =>
    set((s) => ({
      leads: s.leads.map((l) =>
        l.id === id ? { ...l, stage, last: `Moved to ${stage}` } : l
      ),
    })),

  addLeadNote: (id, note) => {
    const fullNote: LeadNote = { ...note, id: String(Date.now()) };
    set((s) => ({
      leads: s.leads.map((l) =>
        l.id === id
          ? { ...l, acts: [...(l.acts ?? []), fullNote], last: note.t ?? note.notes ?? l.last }
          : l
      ),
    }));
    return fullNote;
  },

  // Powers the home queue's 30s Undo — removes exactly the note a Send appended.
  removeLeadNote: (id, noteId) =>
    set((s) => ({
      leads: s.leads.map((l) =>
        l.id === id ? { ...l, acts: (l.acts ?? []).filter((a) => a.id !== noteId) } : l
      ),
    })),

  archiveLead: (id) =>
    set((s) => ({
      leads: s.leads.map((l) => (l.id === id ? { ...l, archived: true } : l)),
    })),

  restoreLead: (id) =>
    set((s) => ({
      leads: s.leads.map((l) => (l.id === id ? { ...l, archived: false } : l)),
    })),

  deleteLead: (id) =>
    set((s) => ({
      leads: s.leads.filter((l) => l.id !== id),
    })),

  addEvisit: (leadId, draft) => {
    const visit: Visit = { ...draft, id: nextLeadId() };
    set((s) => ({
      leads: s.leads.map((l) =>
        l.id === leadId ? { ...l, evisits: [...(l.evisits ?? []), visit] } : l
      ),
    }));
    return visit;
  },

  updateEvisit: (leadId, visitId, patch) =>
    set((s) => ({
      leads: s.leads.map((l) =>
        l.id === leadId
          ? { ...l, evisits: (l.evisits ?? []).map((v) => (v.id === visitId ? { ...v, ...patch } : v)) }
          : l
      ),
    })),

  placeEvisit: (leadId, visitId, at) =>
    set((s) => ({
      leads: s.leads.map((l) =>
        l.id === leadId
          ? { ...l, evisits: (l.evisits ?? []).map((v) => (v.id === visitId ? { ...v, ...at } : v)) }
          : l
      ),
    })),

  removeEvisit: (leadId, visitId) =>
    set((s) => ({
      leads: s.leads.map((l) =>
        l.id === leadId
          ? { ...l, evisits: (l.evisits ?? []).filter((v) => v.id !== visitId) }
          : l
      ),
    })),

  taskDone: (id) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: true } : t)),
    })),

  // Flip a task's done state — the lead-modal Tasks checkboxes (mark done / reopen).
  toggleTask: (id) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    })),

  addTask: (draft) => {
    const newTask: Task = { ...draft, id: nextTaskId(), done: false };
    set((s) => ({ tasks: [newTask, ...s.tasks] }));
  },
});
