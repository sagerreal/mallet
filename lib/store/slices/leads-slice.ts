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
 *
 * updateLead follows the same pattern for persistable scalar fields (name, phone,
 * email, source, stage, unread, companyId, role, value→valueCents).
 * Local-only fields (age, job, last, book, address, estId, acts, evisits) are
 * updated in the store only — they have no column in the DB contract.
 */

import type { StateCreator } from "zustand";
import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "@/trpc/root";
import type { Lead, LeadNote, Task, Visit } from "../types";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { storeStageToBackend, backendStageToStore } from "@/lib/store/dto-mapper";

type CustomerUpdateInput = inferRouterInputs<AppRouter>["v1"]["customers"]["update"];

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

// Fields in Lead that are ONLY local — they have no column in the DB contract
// and must never be sent to v1.customers.update.
const LOCAL_ONLY_KEYS = new Set<keyof Lead>(["age", "job", "last", "book", "address", "estId", "acts", "evisits"]);

/** The shape expected by trpcVanilla.v1.customers.update.mutate */
export type LeadUpdatePayload = CustomerUpdateInput;

/**
 * Builds the tRPC mutation payload from a Lead patch, including only the
 * fields that are persisted in the DB.  Returns null when the patch contains
 * ONLY local-only fields (e.g. { last }, { address }, { book }) — callers
 * should skip the network call in that case.
 */
export function buildLeadUpdatePayload(
  leadId: string,
  patch: Partial<Lead>,
): LeadUpdatePayload | null {
  const payload: LeadUpdatePayload = { leadId };
  let hasPersistedField = false;

  for (const key of Object.keys(patch) as Array<keyof Lead>) {
    if (LOCAL_ONLY_KEYS.has(key)) continue;

    hasPersistedField = true;

    if (key === "phone") {
      // Map empty string → null (no phone on file)
      const raw = patch.phone;
      payload.phone = raw === "" ? null : (raw ?? null);
    } else if (key === "email") {
      // Map empty string → null
      const raw = patch.email;
      payload.email = raw === "" ? null : (raw ?? null);
    } else if (key === "value") {
      // Store keeps value in dollars; the DTO expects integer cents.
      const dollars = patch.value;
      if (dollars !== undefined) {
        payload.valueCents = Math.round(dollars * 100);
      }
    } else if (key === "name") {
      payload.name = patch.name;
    } else if (key === "source") {
      payload.source = patch.source;
    } else if (key === "stage") {
      // Store Lead.stage is a display string; the router validates the enum
      // server-side. Map display → enum before sending.
      if (patch.stage !== undefined) {
        payload.stage = storeStageToBackend(patch.stage) as CustomerUpdateInput["stage"];
      }
    } else if (key === "unread") {
      payload.unread = patch.unread;
    } else if (key === "companyId") {
      payload.companyId = patch.companyId ?? null;
    } else if (key === "role") {
      payload.role = patch.role;
    }
    // Remaining fields (notes, card, custom, lossReason, archived, trash) are either
    // handled by dedicated mutations or are not yet wired to the DB — skip them.
  }

  return hasPersistedField ? payload : null;
}

/**
 * Merges a leadDTO response back onto the current store lead, preserving all
 * local-only fields (acts, evisits, age, job, last, book, address, estId).
 * The DTO shape mirrors RouterOutputs["v1"]["customers"]["list"]["items"][number].
 */
function reconcileLeadFromDTO(
  current: Lead,
  dto: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    source: string | null;
    stage: string;
    value: { cents: number; currency: string };
    unread: boolean;
    companyId: string | null;
    role: string | null;
  },
): Lead {
  return {
    // Start with current so any unknown fields are preserved.
    ...current,
    // Overwrite with authoritative values from the DTO.
    name: dto.name,
    phone: dto.phone ?? "",
    email: dto.email ?? undefined,
    source: dto.source ?? "",
    // DTO carries the DB enum; the store renders display strings.
    stage: backendStageToStore(dto.stage),
    value: dto.value.cents / 100,
    unread: dto.unread,
    companyId: dto.companyId ?? undefined,
    role: dto.role ?? undefined,
    // Explicitly re-pin ALL eight local-only fields so the contract is
    // drift-safe regardless of what the spread above brings in from current.
    age: current.age,
    job: current.job,
    last: current.last,
    book: current.book,
    address: current.address,
    estId: current.estId,
    acts: current.acts,
    evisits: current.evisits,
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
  updateTask: (id: string, patch: { t?: string; due?: string | null }) => void;
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

  // ---------------------------------------------------------------------------
  // updateLead — optimistic + persist + reconcile/rollback.
  //
  // Persistable fields (name, phone, email, source, stage, unread, companyId,
  // role, value) are written to the DB via v1.customers.update.  Local-only
  // fields (age, job, last, book, address, estId, acts, evisits) are updated
  // in the store only — they have no column in the DB contract.
  // If the patch contains ONLY local-only fields the network call is skipped.
  // ---------------------------------------------------------------------------
  updateLead: (id, patch) => {
    // 1. Capture only the prior values of the patched keys — surgical rollback
    //    so a concurrent edit to a different field on the same lead is not clobbered.
    const priorLead = get().leads.find((l) => l.id === id);
    const changedKeys = Object.keys(patch) as (keyof Lead)[];
    // 2. Apply optimistic update immediately.
    set((s) => ({
      leads: s.leads.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    }));
    // 3. Build the mutation payload (null = only local-only fields → skip).
    const mutPayload = buildLeadUpdatePayload(id, patch);
    if (mutPayload === null) {
      // Nothing persistable in this patch; local update is all we need.
      return;
    }
    trpcVanilla.v1.customers.update
      .mutate(mutPayload)
      .then((dto) => {
        // 4a. Reconcile: merge DTO onto the CURRENT lead (which may have
        //     received further optimistic patches since this call started).
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === id ? reconcileLeadFromDTO(l, dto) : l,
          ),
        }));
      })
      .catch((err: unknown) => {
        // 4b. Field-level rollback: revert ONLY the keys this patch changed on
        //     ONLY this lead.  Any concurrent edit to another field/lead is
        //     left untouched.
        set((s) => ({
          leads: s.leads.map((l) => {
            if (l.id !== id || !priorLead) return l;
            const reverted = { ...l };
            for (const k of changedKeys) (reverted as any)[k] = (priorLead as any)[k];
            return reverted;
          }),
        }));
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.error("[leads-slice] updateLead failed — rolled back", { id, patch, err });
        }
      });
  },

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
  // updateTask — optimistic update of text and/or due date; persist via
  // v1.tasks.update({ taskId, text?, dueDate? }); reconcile returned DTO;
  // rollback on error. Only sends changed fields; empty string due → null.
  // ---------------------------------------------------------------------------
  updateTask: (id, patch) => {
    const prior = get().tasks.slice();
    // Optimistic update immediately.
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id
          ? {
              ...t,
              ...(patch.t !== undefined ? { t: patch.t } : {}),
              ...(patch.due !== undefined ? { due: patch.due } : {}),
            }
          : t,
      ),
    }));
    // Build the mutation payload — only send changed fields.
    const mutInput: { taskId: string; text?: string; dueDate?: string | null } = {
      taskId: id,
    };
    if (patch.t !== undefined) mutInput.text = patch.t;
    if (patch.due !== undefined) {
      // Map empty string → null (no due date).
      mutInput.dueDate = patch.due === "" ? null : patch.due;
    }
    trpcVanilla.v1.tasks.update
      .mutate(mutInput)
      .then((dto) => {
        const reconciled = dtoToTask(dto);
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === reconciled.id ? reconciled : t)),
        }));
      })
      .catch((err: unknown) => {
        set({ tasks: prior });
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.error("[leads-slice] updateTask failed — rolled back", { id, patch, err });
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
