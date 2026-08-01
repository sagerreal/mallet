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
 * Local-only fields (age, job, last, book, estId, acts) are
 * updated in the store only — they have no column in the DB contract.
 */

import type { StateCreator } from "zustand";
import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "@/trpc/root";
import type { Lead, LeadNote, Task, Visit } from "../types";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { invalidateLists } from "@/lib/trpc/list-cache";
import { storeStageToBackend, backendStageToStore } from "@/lib/store/dto-mapper";
import { reportWriteError } from "../write-error";

type CustomerUpdateInput = inferRouterInputs<AppRouter>["v1"]["customers"]["update"];

/** Server-side note ids are UUIDs; seeded/legacy entries are not, and have no row to delete. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
const LOCAL_ONLY_KEYS = new Set<keyof Lead>(["age", "job", "last", "book", "estId", "acts"]);

/** The shape expected by trpcVanilla.v1.customers.update.mutate */
export type LeadUpdatePayload = CustomerUpdateInput;

/**
 * Builds the tRPC mutation payload from a Lead patch, including only the
 * fields that are persisted in the DB.  Returns null when the patch contains
 * ONLY local-only fields (e.g. { last }, { book }) — callers
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
    } else if (key === "customFields") {
      payload.customFields = patch.customFields ?? null;
    } else if (key === "address") {
      // Map empty string → null (no address on file).
      const raw = patch.address;
      payload.address = raw === "" ? null : (raw ?? null);
    }
    // Remaining fields (notes, card, custom, lossReason, archived, trash) are either
    // handled by dedicated mutations or are not yet wired to the DB — skip them.
  }

  return hasPersistedField ? payload : null;
}

/**
 * Build the store Lead that replaces the optimistic row once create resolves.
 * The server assigns the id (dedupe may return an existing row), so we key off
 * the DTO id and re-pin all local-only fields from the optimistic row.
 */
function adoptCreatedLead(optimistic: Lead, dto: Parameters<typeof reconcileLeadFromDTO>[1]): Lead {
  // reconcileLeadFromDTO preserves local-only fields and maps the stage; the
  // only extra step is adopting the server id.
  return { ...reconcileLeadFromDTO(optimistic, dto), id: dto.id };
}

/**
 * Merges a leadDTO response back onto the current store lead, preserving all
 * local-only fields (acts, age, job, last, book, estId).
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
    customFields?: { label: string; value: string }[] | null;
    notes?: string | null;
    address?: string | null;
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
    customFields: dto.customFields !== undefined ? (dto.customFields ?? undefined) : current.customFields,
    // notes is persisted; adopt from DTO when present, otherwise keep current.
    notes: dto.notes !== undefined ? (dto.notes ?? undefined) : current.notes,
    // address is persisted; adopt from DTO when present, otherwise keep current.
    address: dto.address !== undefined ? (dto.address ?? undefined) : current.address,
    // Explicitly re-pin ALL seven local-only fields so the contract is
    // drift-safe regardless of what the spread above brings in from current.
    age: current.age,
    job: current.job,
    last: current.last,
    book: current.book,
    estId: current.estId,
    acts: current.acts,
  };
}

export interface LeadsSlice {
  leads: Lead[];
  tasks: Task[];

  /** Replace the entire leads array — called by the server hydrator. */
  setLeads: (leads: Lead[]) => void;
  /** Put a customer fetched by id into the store, without a network write. See adoptJob. */
  adoptLead: (lead: Lead) => void;
  /** Replace the entire tasks array — called by the TasksHydrator. */
  setTasks: (tasks: Task[]) => void;

  addLead: (
    draft: Omit<Lead, "id" | "age" | "last" | "acts">,
  ) => { lead: Lead; persisted: Promise<Lead> };
  /**
   * Optimistic + persist + reconcile. Resolves TRUE once the change is durable — or when the
   * patch had nothing to persist — and FALSE when the write failed and was rolled back.
   *
   * Awaiting is optional and most callers don't: the point of the optimistic write is that the
   * UI moves now. It matters only for a caller whose NEXT step is a server call that reads what
   * this one wrote, because the server reads the database and not this store.
   */
  updateLead: (id: string, patch: Partial<Lead>) => Promise<boolean>;
  moveLeadStage: (id: string, stage: string) => void;
  addLeadNote: (id: string, note: Omit<LeadNote, "id">) => LeadNote;
  removeLeadNote: (id: string, noteId: string) => void;
  adoptLeadNotes: (id: string, notes: LeadNote[]) => void;
  archiveLead: (id: string) => void;
  restoreLead: (id: string) => void;
  deleteLead: (id: string) => void;

  taskDone: (id: string) => void;
  toggleTask: (id: string) => void;
  addTask: (draft: Omit<Task, "id" | "done">) => void;
  updateTask: (id: string, patch: { t?: string; due?: string | null; leadId?: string | null }) => void;
  removeTask: (id: string) => void;
}

export const createLeadsSlice: StateCreator<LeadsSlice, [], [], LeadsSlice> = (set, get) => ({
  leads: [],
  tasks: [],

  setLeads: (leads) => set({ leads }),

  // ---------------------------------------------------------------------------
  // adoptLead — a customer the store never hydrated, fetched by id and merged in.
  //
  // The Customers list is served by the database a page at a time, so it shows
  // customers outside the hydrator's page. Opening one of those found nothing in
  // the store and rendered "This customer is no longer available — they may have
  // been archived", which is not merely unhelpful, it is FALSE: the customer
  // exists and is not archived. Same failure the Jobs list had before adoptJob.
  //
  // Replace by id when already present (idempotent), else prepend. No mutation
  // fires — this is a read arriving late, not an edit.
  // ---------------------------------------------------------------------------
  adoptLead: (lead) =>
    set((s) => ({
      leads: s.leads.some((l) => l.id === lead.id)
        ? s.leads.map((l) => (l.id === lead.id ? { ...l, ...lead } : l))
        : [lead, ...s.leads],
    })),

  setTasks: (tasks) => set({ tasks }),

  addLead: (draft) => {
    const id = crypto.randomUUID();
    const newLead: Lead = {
      ...draft,
      id,
      age: 0,
      last: "Just added",
      acts: [],
    };
    // Snapshot BEFORE the optimistic insert so we can roll back on failure.
    const prior = get().leads.slice();
    set((s) => ({ leads: [newLead, ...s.leads] }));

    // Persist. The server assigns the id (create dedupes on phone), so the
    // reconcile swaps the optimistic id for the server id. Callers holding the
    // returned lead must read the reconciled id from `persisted`.
    const persisted: Promise<Lead> = trpcVanilla.v1.customers.create
      .mutate({
        name: newLead.name,
        // create input treats empty phone/email as "not provided" — send only when set.
        ...(newLead.phone && newLead.phone !== "—" ? { phone: newLead.phone } : {}),
        ...(newLead.email ? { email: newLead.email } : {}),
        ...(newLead.source ? { source: newLead.source } : {}),
        ...(newLead.companyId ? { companyId: newLead.companyId } : {}),
        ...(newLead.role ? { role: newLead.role } : {}),
        ...(newLead.notes ? { notes: newLead.notes } : {}),
        ...(newLead.address ? { address: newLead.address } : {}),
      })
      .then((dto) => {
        const reconciled = adoptCreatedLead(newLead, dto);
        set((s) => ({
          leads: s.leads.map((l) => (l.id === id ? reconciled : l)),
        }));
        // The Customers list and the Pipeline columns render a fetched PAGE, not this store — so a
        // new customer stays invisible there until something refetches. After the write, never
        // alongside it: a refetch that overtakes the commit returns the list without this row.
        invalidateLists("customers");
        return reconciled;
      })
      .catch((err: unknown) => {
        // Rollback: restore the pre-insert snapshot (removes the optimistic row).
        set({ leads: prior });
        reportWriteError("addLead", err);
        throw err instanceof Error ? err : new Error("addLead failed");
      });

    return { lead: newLead, persisted };
  },

  // ---------------------------------------------------------------------------
  // updateLead — optimistic + persist + reconcile/rollback.
  //
  // Persistable fields (name, phone, email, source, stage, unread, companyId,
  // role, value) are written to the DB via v1.customers.update.  Local-only
  // fields (age, job, last, book, estId, acts) are updated
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
      return Promise.resolve(true);
    }
    return trpcVanilla.v1.customers.update
      .mutate(mutPayload)
      .then((dto) => {
        // 4a. Reconcile: merge DTO onto the CURRENT lead (which may have
        //     received further optimistic patches since this call started).
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === id ? reconcileLeadFromDTO(l, dto) : l,
          ),
        }));
        // An edit can move the row to a different page: renaming re-sorts it, and a stage change
        // moves it between Pipeline columns. Refetch rather than patch the cached page.
        invalidateLists("customers");
        return true;
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
        reportWriteError("updateLead", err);
        return false;
      });
  },

  moveLeadStage: (id, stage) => {
    // Optimistic local touch: stage + the "Moved to" activity line. The stage
    // itself persists through updateLead (which maps display→enum and reconciles).
    set((s) => ({
      leads: s.leads.map((l) =>
        l.id === id ? { ...l, last: `Moved to ${stage}` } : l,
      ),
    }));
    // updateLead handles the optimistic stage write + persist + reconcile/rollback.
    get().updateLead(id, { stage });
  },

  // ---------------------------------------------------------------------------
  // addLeadNote — OPTIMISTIC + PERSIST + ROLLBACK.
  //
  // This used to write to the store and stop. The store has no persist middleware and the leads
  // hydrator resets `acts: []` on every refetch, so a gate code typed into the Notes composer did
  // not even survive to a reload — only to the next background refetch. Every logged call, sent
  // text and Front Desk entry appends through here too, so the whole customer activity trail was
  // ephemeral.
  //
  // The id is client-authored and a real UUID: the home queue's 30s Undo needs it synchronously,
  // and the row must carry the same one. (It was `String(Date.now())` — not a UUID, and two notes
  // added inside the same millisecond collided.)
  // ---------------------------------------------------------------------------
  addLeadNote: (id, note) => {
    const fullNote: LeadNote = { ...note, id: crypto.randomUUID() };
    const prior = get().leads.slice();
    const known = prior.some((l) => l.id === id);
    set((s) => ({
      leads: s.leads.map((l) =>
        l.id === id
          ? { ...l, acts: [...(l.acts ?? []), fullNote], last: note.t ?? note.notes ?? l.last }
          : l
      ),
    }));
    // A note against a customer the store never loaded has nowhere to render and no lead row to
    // roll back — persisting it would write a record no surface could show.
    if (!known) return fullNote;

    trpcVanilla.v1.customers.addNote
      .mutate({
        id: fullNote.id!,
        leadId: id,
        kind: note.type,
        body: note.t ?? note.notes ?? "",
        author: note.from ?? null,
        direction: note.dir ?? null,
        outcome: note.outcome ?? null,
        durationLabel: note.dur ?? null,
        via: note.via ?? null,
        overnight: note.overnight ?? false,
      })
      .catch((err: unknown) => {
        // Rollback: a note that silently failed to save is the bug this replaces.
        set({ leads: prior });
        reportWriteError("addLeadNote", err);
      });
    return fullNote;
  },

  /**
   * The trail as the database has it, merged into whatever the store already holds.
   *
   * Server rows win on id, and any local entry the server does not know about is KEPT: a note
   * typed a moment ago may still be in flight, and dropping it would make it blink out and
   * reappear. Ordering follows the server (oldest first), with the unknown locals after it.
   */
  adoptLeadNotes: (id, notes) =>
    set((s) => ({
      leads: s.leads.map((l) => {
        if (l.id !== id) return l;
        const serverIds = new Set(notes.map((n) => n.id));
        const localOnly = (l.acts ?? []).filter((a) => !a.id || !serverIds.has(a.id));
        return { ...l, acts: [...notes, ...localOnly] };
      }),
    })),

  // Powers the home queue's 30s Undo — removes exactly the note a Send appended. The server
  // delete matters: without it the next refetch resurrects a record of a retracted message.
  removeLeadNote: (id, noteId) => {
    const prior = get().leads.slice();
    set((s) => ({
      leads: s.leads.map((l) =>
        l.id === id ? { ...l, acts: (l.acts ?? []).filter((a) => a.id !== noteId) } : l
      ),
    }));
    // Only UUID ids exist server-side. Seeded and legacy entries have no row to delete, and
    // asking would fail the input schema rather than the lookup.
    if (!UUID_RE.test(noteId)) return;
    trpcVanilla.v1.customers.removeNote.mutate({ noteId }).catch((err: unknown) => {
      set({ leads: prior });
      reportWriteError("removeLeadNote", err);
    });
  },

  archiveLead: (id) => {
    const prior = get().leads.slice();
    set((s) => ({
      leads: s.leads.map((l) => (l.id === id ? { ...l, archived: true } : l)),
    }));
    void trpcVanilla.v1.customers.archive
      .mutate({ leadId: id })
      .then(() => invalidateLists("customers"))
      .catch((err: unknown) => {
        set({ leads: prior });
        reportWriteError("archiveLead", err);
      });
  },

  restoreLead: (id) => {
    const prior = get().leads.slice();
    set((s) => ({
      leads: s.leads.map((l) => (l.id === id ? { ...l, archived: false } : l)),
    }));
    trpcVanilla.v1.customers.restore
      .mutate({ leadId: id })
      .then((dto) => {
        // Reconcile the authoritative row (stage mapped enum→display).
        set((s) => ({
          leads: s.leads.map((l) => (l.id === id ? reconcileLeadFromDTO(l, dto) : l)),
        }));
        // Restoring puts the row back into the Active list, which is a different fetched set.
        invalidateLists("customers");
      })
      .catch((err: unknown) => {
        set({ leads: prior });
        reportWriteError("restoreLead", err);
      });
  },

  // Soft-delete only: "delete" archives the lead (no hard delete, no row removal).
  // Live views already filter on !archived, so the archived row disappears from the UI.
  deleteLead: (id) => {
    get().archiveLead(id);
  },

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
        reportWriteError("taskDone", err);
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
        reportWriteError("toggleTask", err);
      });
  },

  // ---------------------------------------------------------------------------
  // updateTask — optimistic update of text, due date, and/or attached lead; persist via
  // v1.tasks.update({ taskId, text?, dueDate?, leadId? }); reconcile returned DTO;
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
              ...(patch.leadId !== undefined ? { leadId: patch.leadId === "" ? null : patch.leadId } : {}),
            }
          : t,
      ),
    }));
    // Build the mutation payload — only send changed fields.
    const mutInput: { taskId: string; text?: string; dueDate?: string | null; leadId?: string | null } = {
      taskId: id,
    };
    if (patch.t !== undefined) mutInput.text = patch.t;
    if (patch.due !== undefined) {
      // Map empty string → null (no due date).
      mutInput.dueDate = patch.due === "" ? null : patch.due;
    }
    // Map empty string → null (unattached); a uuid string → that lead.
    if (patch.leadId !== undefined) mutInput.leadId = patch.leadId === "" ? null : patch.leadId;
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
        reportWriteError("updateTask", err);
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
        reportWriteError("addTask", err);
      });
  },

  // ---------------------------------------------------------------------------
  // removeTask — optimistic remove; persist via v1.tasks.remove({ taskId }) (a
  // server-side soft-delete); rollback on error. Mirrors addTask's snapshot shape.
  // ---------------------------------------------------------------------------
  removeTask: (id) => {
    const prior = get().tasks.slice();
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
    trpcVanilla.v1.tasks.remove
      .mutate({ taskId: id })
      .catch((err: unknown) => {
        set({ tasks: prior });
        reportWriteError("removeTask", err);
      });
  },
});
