/**
 * lib/store/slices/leads-slice.ts
 * Lead data — starts empty, populated by the LeadsHydrator from tRPC on mount.
 * All updates are immutable (spread patterns only).
 *
 * Task mutations (addTask / toggleTask / taskDone) are OPTIMISTIC + PERSIST + RECONCILE:
 *   1. Apply local change immediately so the UI is instant.
 *   2. Fire the matching v1.tasks mutation via trpcVanilla.
 *   3. On success, reconcile the returned TaskDTO (id stays stable — client-authored).
 *   4. On error, ROLL BACK to the pre-mutation snapshot and log (dev only).
 */

import type { StateCreator } from "zustand";
import type { Lead, LeadNote, Task, Visit } from "../types";
import { trpcVanilla } from "@/lib/trpc/vanilla";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function dtoToTask(dto: { id: string; text: string; dueDate: string | null; leadId: string | null; done: boolean }): Task {
  return {
    id: dto.id,
    t: dto.text,
    due: dto.dueDate,
    leadId: dto.leadId,
    done: dto.done,
  };
}

export interface LeadsSlice {
  leads: Lead[];
  tasks: Task[];

  /** Replace the entire leads array — called by the server hydrator. */
  setLeads: (leads: Lead[]) => void;
  /** Replace the entire tasks array — called by the TasksHydrator. */
  setTasks: (tasks: Task[]) => void;

  addLead: (draft: Omit<Lead, "id" | "age" | "last" | "acts" | "evisits">) => Lead;
  updateLead: (id: string, patch: Partial<Lead>) => void;
  moveLeadStage: (id: string, stage: string) => void;
  addLeadNote: (id: string, note: Omit<LeadNote, "id">) => LeadNote;
  removeLeadNote: (id: string, noteId: string) => void;
  archiveLead: (id: string) => void;
  restoreLead: (id: string) => void;
  deleteLead: (id: string) => void;

  // Estimate-visit (evisit) placement on the schedule board.
  addEvisit: (leadId: string, draft: Omit<Visit, "id">) => Visit;
  updateEvisit: (leadId: string, visitId: string, patch: Partial<Visit>) => void;
  placeEvisit: (leadId: string, visitId: string, at: { techId: string; date: string; start: number }) => void;
  removeEvisit: (leadId: string, visitId: string) => void;

  taskDone: (id: string) => void;
  toggleTask: (id: string) => void;
  addTask: (draft: Omit<Task, "id" | "done">) => void;
}

export const createLeadsSlice: StateCreator<LeadsSlice, [], [], LeadsSlice> = (set, get) => ({
  leads: [],
  tasks: [],

  setLeads: (leads) => set({ leads }),

  setTasks: (tasks) => set({ tasks }),

  addLead: (draft) => {
    const newLead: Lead = {
      ...draft,
      id: crypto.randomUUID(),
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
    const visit: Visit = { ...draft, id: crypto.randomUUID() };
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

  // ---------------------------------------------------------------------------
  // taskDone — optimistic + persist + reconcile/rollback.
  // ---------------------------------------------------------------------------
  taskDone: (id) => {
    const prior = get().tasks.slice();
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: true } : t)),
    }));
    trpcVanilla.v1.tasks.setDone
      .mutate({ taskId: id, done: true })
      .then((dto) => {
        const reconciled = dtoToTask(dto);
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === reconciled.id ? reconciled : t)) }));
      })
      .catch((err: unknown) => {
        set({ tasks: prior });
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.error("[leads-slice] taskDone failed — rolled back", { id, err });
        }
      });
  },

  // ---------------------------------------------------------------------------
  // toggleTask — flip done state; optimistic + persist + reconcile/rollback.
  // ---------------------------------------------------------------------------
  toggleTask: (id) => {
    const prior = get().tasks.slice();
    const currentTask = prior.find((t) => t.id === id);
    const nextDone = !currentTask?.done;
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: nextDone } : t)),
    }));
    trpcVanilla.v1.tasks.setDone
      .mutate({ taskId: id, done: nextDone })
      .then((dto) => {
        const reconciled = dtoToTask(dto);
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === reconciled.id ? reconciled : t)) }));
      })
      .catch((err: unknown) => {
        set({ tasks: prior });
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.error("[leads-slice] toggleTask failed — rolled back", { id, err });
        }
      });
  },

  // ---------------------------------------------------------------------------
  // addTask — mint UUID client-side (client-authored id); optimistic prepend;
  // persist via create; reconcile returned DTO (id stays stable); rollback on error.
  // ---------------------------------------------------------------------------
  addTask: (draft) => {
    const id = crypto.randomUUID();
    const newTask: Task = { ...draft, id, done: false };
    // Capture snapshot BEFORE the optimistic update.
    const prior = get().tasks.slice();
    set((s) => ({ tasks: [newTask, ...s.tasks] }));
    trpcVanilla.v1.tasks.create
      .mutate({
        id,
        text: draft.t,
        dueDate: draft.due || null,
        leadId: draft.leadId,
      })
      .then((dto) => {
        const reconciled = dtoToTask(dto);
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === reconciled.id ? reconciled : t)) }));
      })
      .catch((err: unknown) => {
        // Rollback: restore pre-mutation state (removes the optimistic task).
        set({ tasks: prior });
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.error("[leads-slice] addTask failed — rolled back", { id, err });
        }
      });
  },
});
