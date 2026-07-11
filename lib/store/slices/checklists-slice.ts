/**
 * lib/store/slices/checklists-slice.ts
 * Checklist templates (job "before you leave" + scope "visit" checklist).
 * DB-backed: ChecklistsHydrator seeds the slice from v1.checklists.list; every
 * mutating action is optimistic → persist via trpcVanilla → reconcile/rollback,
 * mirroring addCompany (data-slice) and updateLead (leads-slice). Immutable updates only.
 */

import type { StateCreator } from "zustand";
import type { Checklist, ChecklistItem } from "../types";
import { trpcVanilla } from "@/lib/trpc/vanilla";

// DTO shape returned by v1.checklists.* mutations — mirrors ChecklistDTO from the router.
interface ChecklistItemDTO {
  id: string;
  text: string;
  type: "check" | "photo";
  required: boolean;
  position: number;
}

interface ChecklistDTO {
  id: string;
  name: string;
  trade: string;
  stage: "job" | "scope";
  match: string[];
  items: ChecklistItemDTO[];
  createdAt: string;
}

/** Convert a server DTO into the store's Checklist shape. Single conversion site (DRY). */
function dtoToStore(dto: ChecklistDTO): Checklist {
  return {
    id: dto.id,
    name: dto.name,
    trade: dto.trade,
    stage: dto.stage,
    match: [...dto.match],
    items: dto.items.map((it) => ({
      id: it.id,
      text: it.text,
      type: it.type,
      required: it.required,
      position: it.position,
    })),
  };
}

/** Replace a checklist by id in a list; returns a new array (immutable). */
function reconcileChecklist(list: Checklist[], dto: ChecklistDTO): Checklist[] {
  const updated = dtoToStore(dto);
  return list.map((c) => (c.id === dto.id ? updated : c));
}

export interface ChecklistsSlice {
  checklists: Checklist[];
  /** Replace the slice — called by ChecklistsHydrator on hydration. */
  setChecklists: (checklists: Checklist[]) => void;
  addChecklist: (
    name: string,
    stage: Checklist["stage"],
  ) => { checklist: Checklist; persisted: Promise<void> };
  deleteChecklist: (id: string) => void;
  addChecklistItem: (
    checklistId: string,
    text: string,
    type?: ChecklistItem["type"],
  ) => void;
  deleteChecklistItem: (checklistId: string, itemId: string) => void;
  toggleItemRequired: (checklistId: string, itemId: string) => void;
}

export const createChecklistsSlice: StateCreator<
  ChecklistsSlice,
  [],
  [],
  ChecklistsSlice
> = (set, get) => ({
  // Starts empty — ChecklistsHydrator fills this from the DB.
  checklists: [],

  setChecklists: (checklists) => set({ checklists }),

  addChecklist: (name, stage) => {
    // Mint a client-authored UUID — the server preserves it as the row id.
    const id = crypto.randomUUID();
    const checklist: Checklist = {
      id,
      name: name.trim() || "New checklist",
      trade: "Custom",
      stage,
      match: [],
      items: [],
    };

    // Optimistic append — UI reflects the new checklist immediately.
    set((s) => ({ checklists: [...s.checklists, checklist] }));

    // Persist and expose the promise so callers that need the FK committed can await it.
    const persisted = trpcVanilla.v1.checklists.create
      .mutate({ id, name: checklist.name, trade: checklist.trade, stage, match: [] })
      .then((dto) => {
        // Reconcile: adopt the server's canonical name/trade.
        set((s) => ({ checklists: reconcileChecklist(s.checklists, dto) }));
      })
      .catch((err: unknown) => {
        if (process.env.NODE_ENV !== "production") {
          console.error("[checklists] addChecklist rollback", err);
        }
        // Rollback on network failure.
        set((s) => ({ checklists: s.checklists.filter((c) => c.id !== id) }));
      }) as Promise<void>;

    return { checklist, persisted };
  },

  deleteChecklist: (id) => {
    // Snapshot before removal for rollback.
    const snapshot = get().checklists;
    set((s) => ({ checklists: s.checklists.filter((c) => c.id !== id) }));

    void trpcVanilla.v1.checklists.remove
      .mutate({ checklistId: id })
      .catch((err: unknown) => {
        if (process.env.NODE_ENV !== "production") {
          console.error("[checklists] deleteChecklist rollback", err);
        }
        set({ checklists: snapshot });
      });
  },

  addChecklistItem: (checklistId, text, type = "check") => {
    // Snapshot before mutation for rollback.
    const snapshot = get().checklists;
    const target = snapshot.find((c) => c.id === checklistId);
    const position = target ? target.items.length : 0;
    // Optimistic item — server will assign its own id; reconciled after resolve.
    const optimisticId = crypto.randomUUID();
    const optimistic: ChecklistItem = {
      id: optimisticId,
      text,
      type,
      required: false,
      position,
    };

    set((s) => ({
      checklists: s.checklists.map((c) =>
        c.id === checklistId
          ? { ...c, items: [...c.items, optimistic] }
          : c,
      ),
    }));

    void trpcVanilla.v1.checklists.addItem
      .mutate({ checklistId, id: optimisticId, text, type })
      .then((dto) => {
        // Reconcile the whole item collection from the server (adopts server ids/positions).
        set((s) => ({ checklists: reconcileChecklist(s.checklists, dto) }));
      })
      .catch((err: unknown) => {
        if (process.env.NODE_ENV !== "production") {
          console.error("[checklists] addChecklistItem rollback", err);
        }
        set({ checklists: snapshot });
      });
  },

  deleteChecklistItem: (checklistId, itemId) => {
    const snapshot = get().checklists;

    set((s) => ({
      checklists: s.checklists.map((c) =>
        c.id === checklistId
          ? { ...c, items: c.items.filter((i) => i.id !== itemId) }
          : c,
      ),
    }));

    void trpcVanilla.v1.checklists.removeItem
      .mutate({ checklistId, itemId })
      .then((dto) => {
        // Reconcile from server (positions may reorder after removal).
        set((s) => ({ checklists: reconcileChecklist(s.checklists, dto) }));
      })
      .catch((err: unknown) => {
        if (process.env.NODE_ENV !== "production") {
          console.error("[checklists] deleteChecklistItem rollback", err);
        }
        set({ checklists: snapshot });
      });
  },

  toggleItemRequired: (checklistId, itemId) => {
    const snapshot = get().checklists;
    const current = snapshot
      .find((c) => c.id === checklistId)
      ?.items.find((i) => i.id === itemId);
    const nextRequired = !(current?.required ?? false);

    set((s) => ({
      checklists: s.checklists.map((c) =>
        c.id === checklistId
          ? {
              ...c,
              items: c.items.map((i) =>
                i.id === itemId ? { ...i, required: nextRequired } : i,
              ),
            }
          : c,
      ),
    }));

    void trpcVanilla.v1.checklists.setItemRequired
      .mutate({ checklistId, itemId, required: nextRequired })
      .then((dto) => {
        // Reconcile from server (confirms the required flip and any other changes).
        set((s) => ({ checklists: reconcileChecklist(s.checklists, dto) }));
      })
      .catch((err: unknown) => {
        if (process.env.NODE_ENV !== "production") {
          console.error("[checklists] toggleItemRequired rollback", err);
        }
        set({ checklists: snapshot });
      });
  },
});
