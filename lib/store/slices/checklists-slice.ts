/**
 * lib/store/slices/checklists-slice.ts
 * Saved checklists (job "before you leave" + scope "visit" checklist).
 * DB-backed: ChecklistsHydrator seeds the slice from v1.checklists.list; every
 * mutating action is optimistic → persist via trpcVanilla → reconcile/rollback,
 * mirroring addCompany (data-slice) and updateLead (leads-slice). Immutable updates only.
 *
 * addChecklist creates the template AND its items in ONE v1.checklists.create
 * mutation — the old create + addItem-per-item pattern batched into a single
 * tRPC request whose procedures ran concurrently server-side, so addItem raced
 * the template insert and 404'd ("checklist not found"), leaving templates
 * saved EMPTY. Item-level editing actions were removed with the standards
 * modal: a saved checklist is deleted/recreated whole, never patched.
 */

import type { StateCreator } from "zustand";
import type { Checklist, ChecklistItem } from "../types";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { checklistDtoToStore } from "@/lib/store/checklists-mapper";

/** An item authored at create time — ids/positions are minted by the slice. */
export interface NewChecklistItem {
  text: string;
  type: ChecklistItem["type"];
  required?: boolean;
}

export interface ChecklistsSlice {
  checklists: Checklist[];
  /** Replace the slice — called by ChecklistsHydrator on hydration. */
  setChecklists: (checklists: Checklist[]) => void;
  /**
   * Create a checklist with its items in ONE mutation. `persisted` resolves
   * with the reconciled (server-canonical) checklist, and REJECTS on failure
   * after rolling back — callers must surface the error (no silent failures).
   */
  addChecklist: (
    name: string,
    stage: Checklist["stage"],
    items?: readonly NewChecklistItem[],
  ) => { checklist: Checklist; persisted: Promise<Checklist> };
  deleteChecklist: (id: string) => void;
  /**
   * Replace an existing checklist's name + items in ONE mutation. Optimistic
   * update is immediate; resolves with the reconciled (server-canonical)
   * checklist, rejects on failure after rolling back.
   */
  updateChecklist: (
    id: string,
    name: string,
    items: NewChecklistItem[],
  ) => Promise<Checklist>;
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

  addChecklist: (name, stage, items = []) => {
    // Mint client-authored UUIDs — the server preserves them as row ids.
    const id = crypto.randomUUID();
    const authored: ChecklistItem[] = items.map((it, i) => ({
      id: crypto.randomUUID(),
      text: it.text,
      type: it.type,
      required: it.required ?? false,
      position: i,
    }));
    const checklist: Checklist = {
      id,
      name: name.trim() || "Checklist",
      trade: "Custom",
      stage,
      match: [],
      items: authored,
    };

    // Optimistic append — UI reflects the new checklist immediately.
    set((s) => ({ checklists: [...s.checklists, checklist] }));

    // Persist template + items atomically; expose the reconciled result.
    const persisted: Promise<Checklist> = trpcVanilla.v1.checklists.create
      .mutate({
        id,
        name: checklist.name,
        trade: checklist.trade,
        stage,
        match: [],
        items: authored.map((it) => ({
          id: it.id,
          text: it.text,
          type: it.type,
          required: it.required,
        })),
      })
      .then((dto) => {
        // Reconcile: adopt the server's canonical name/items.
        const updated = checklistDtoToStore(dto);
        set((s) => ({
          checklists: s.checklists.map((c) => (c.id === dto.id ? updated : c)),
        }));
        return updated;
      })
      .catch((err: unknown) => {
        if (process.env.NODE_ENV !== "production") {
          console.error("[checklists] addChecklist rollback", err);
        }
        // Rollback on failure, then rethrow so the caller can tell the user.
        set((s) => ({ checklists: s.checklists.filter((c) => c.id !== id) }));
        throw err instanceof Error ? err : new Error("addChecklist failed");
      });

    return { checklist, persisted };
  },

  deleteChecklist: (id) => {
    // Snapshot before removal for rollback.
    const snapshot = get().checklists;
    set((s) => ({ checklists: s.checklists.filter((c) => c.id !== id) }));

    // no reconcile: remove returns nothing; the optimistic removal already reflects success.
    void trpcVanilla.v1.checklists.remove
      .mutate({ checklistId: id })
      .catch((err: unknown) => {
        if (process.env.NODE_ENV !== "production") {
          console.error("[checklists] deleteChecklist rollback", err);
        }
        set({ checklists: snapshot });
      });
  },

  updateChecklist: (id, name, items) => {
    // Snapshot current state for rollback.
    const snapshot = get().checklists;

    // Mint new UUIDs and assign positions for the updated items.
    const authored: ChecklistItem[] = items.map((it, i) => ({
      id: crypto.randomUUID(),
      text: it.text,
      type: it.type,
      required: it.required ?? false,
      position: i,
    }));

    // Optimistic replace — UI reflects the update immediately.
    set((s) => ({
      checklists: s.checklists.map((c) =>
        c.id === id ? { ...c, name: name.trim() || c.name, items: authored } : c,
      ),
    }));

    return trpcVanilla.v1.checklists.update
      .mutate({
        checklistId: id,
        name: name.trim(),
        items: authored.map((it) => ({
          text: it.text,
          type: it.type,
          required: it.required,
        })),
      })
      .then((dto) => {
        const reconciled = checklistDtoToStore(dto);
        set((s) => ({
          checklists: s.checklists.map((c) => (c.id === dto.id ? reconciled : c)),
        }));
        return reconciled;
      })
      .catch((err: unknown) => {
        if (process.env.NODE_ENV !== "production") {
          console.error("[checklists] updateChecklist rollback", err);
        }
        set({ checklists: snapshot });
        throw err instanceof Error ? err : new Error("updateChecklist failed");
      });
  },
});
