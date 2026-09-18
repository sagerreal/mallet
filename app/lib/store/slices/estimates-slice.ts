/**
 * lib/store/slices/estimates-slice.ts
 * Estimate/quote data + mutations. Immutable updates only.
 * Cross-entity effects (e.g. moving the lead stage on send) live in the caller
 * so this slice stays decoupled from the leads slice.
 *
 * PERSISTENCE PATTERN — identical to jobs-slice (visit actions):
 *   1. Optimistic local update (synchronous, instant UI).
 *   2. Fire v1.quoting.* via trpcVanilla — fire-and-forget (.then/.catch).
 *   3. On success, reconcile the returned estimateDTO via dtoEstimateToStore
 *      and REPLACE the record in the store.
 *   4. On error, restore the pre-mutation snapshot; log in dev only.
 *
 * WIRED mutations (backend endpoint exists):
 *   addEstimate                    → v1.quoting.draft
 *   updateEstimate({ status:"sent" })      → v1.quoting.send
 *   updateEstimate({ status:"accepted" })  → v1.quoting.accept (with optional lines;
 *                                            acceptedTier forwards as chosenTier on GBB)
 *   declineEstimate                → v1.quoting.decline (dedicated — requires reason string)
 *   updateEstimate({ archived:true })      → v1.quoting.archive (soft-delete)
 *   restoreEstimate                → v1.quoting.restore
 *   deleteEstimate                 → v1.quoting.archive (soft-delete; no hard delete)
 *
 * CLIENT-LOCAL only (no persistence, by design):
 *   updateEstimate({ fu })         — fu is not a persisted field
 *   recordRead / endRead           — read telemetry is ephemeral (breathing dot)
 *   updateEstimate({ lines })      — in-flight draft line edits before draft is saved;
 *                                    lines for an existing persisted draft use v1.quoting.draft
 *                                    (re-draft) or are committed at accept time via accept-with-lines
 */

import type { StateCreator } from "zustand";
import type { Estimate, EstimateRead } from "../types";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { invalidateLists } from "@/lib/trpc/list-cache";
import { dtoEstimateToStore } from "@/lib/store/dto-mapper";
import type { JobsSlice } from "./jobs-slice";
import { reportWriteError } from "../write-error";

// Continue the sample's Q-numbers (sample tops out at Q-1044).
// After reconcile, the server-canonical `num` overwrites this optimistic value.
let _nextEstNum = 1045;

export interface EstimatesSlice {
  estimates: Estimate[];
  /** Replace the entire estimates array — called by the server hydrator. */
  setEstimates: (estimates: Estimate[]) => void;
  addEstimate: (draft: Omit<Estimate, "id" | "num">) => Estimate;
  /** Insert (or replace by id) an estimate the SERVER already persisted, mapped from its
   *  DTO — no network call. Used by the composer's send flow, which drafts+sends via tRPC
   *  itself; going through addEstimate there would fire a second quoting.draft and orphan
   *  a duplicate draft in the shop rail. */
  adoptEstimate: (dto: Parameters<typeof dtoEstimateToStore>[0], fu: Estimate["fu"]) => void;
  /**
   * Adopt an already-MAPPED estimate — a header from a list read.
   *
   * Separate from adoptEstimate on purpose: that one takes the FULL DTO and runs the full mapper,
   * which reads lines/pricing a list row does not carry. Handing it a summary is what crashed
   * Money and Pipeline; naming the two shapes apart is what stops it happening again.
   */
  adoptEstimateRecord: (estimate: Estimate) => void;
  updateEstimate: (id: string, patch: Partial<Estimate>) => void;
  /** Decline an estimate. Separate from updateEstimate because the backend
   *  requires an explicit reason string. */
  declineEstimate: (id: string, reason: string) => void;
  /** A customer opened the quote page — append the read (marks viewed).
   *  client-local: no persistence */
  recordRead: (id: string, read: EstimateRead) => void;
  /** The customer's session ended — any breathing dot dies.
   *  client-local: no persistence */
  endRead: (id: string) => void;
  restoreEstimate: (id: string) => void;
  deleteEstimate: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function snapshotEst(estimates: Estimate[], id: string): Estimate | undefined {
  return estimates.find((e) => e.id === id);
}

function reconcileEst(estimates: Estimate[], reconciled: Estimate): Estimate[] {
  return estimates.map((e) => (e.id === reconciled.id ? reconciled : e));
}

function restoreEst(estimates: Estimate[], prior: Estimate): Estimate[] {
  return estimates.map((e) => (e.id === prior.id ? prior : e));
}

// ---------------------------------------------------------------------------
// Slice creator
// ---------------------------------------------------------------------------

export const createEstimatesSlice: StateCreator<EstimatesSlice & JobsSlice, [], [], EstimatesSlice> = (set, get) => ({
  estimates: [],

  setEstimates: (estimates) => set({ estimates }),

  adoptEstimateRecord: (estimate) =>
    set((s) => ({
      estimates: s.estimates.some((e) => e.id === estimate.id)
        ? reconcileEst(s.estimates, estimate)
        : [...s.estimates, estimate],
    })),

  adoptEstimate: (dto, fu) => {
    const mapped = dtoEstimateToStore(dto, fu);
    set((s) => ({
      estimates: s.estimates.some((e) => e.id === mapped.id)
        ? reconcileEst(s.estimates, mapped)
        : [...s.estimates, mapped],
    }));
  },

  // ---------------------------------------------------------------------------
  // addEstimate — optimistic + persist via v1.quoting.draft + reconcile/rollback.
  //
  // Callers: composer/page.tsx (saveDraftComposer / sendComposer),
  //          features/counter/execute.ts (executeQuote / executeEstRun).
  //
  // NOTE: v1.quoting.draft requires lines.length >= 1. If lines is empty
  // (blank draft that hasn't been filled yet) the network call is silently
  // skipped — the record stays store-local. Callers that immediately send
  // (sendComposer) will have lines populated before calling addEstimate.
  // ---------------------------------------------------------------------------
  addEstimate: (draft) => {
    const id = crypto.randomUUID();
    const newEst: Estimate = { ...draft, id, num: `Q-${_nextEstNum++}` };

    // 1. Optimistic update.
    const prior = get().estimates.slice();
    set((s) => ({ estimates: [newEst, ...s.estimates] }));

    // 2. Skip network call if there are no lines (blank pre-fill draft) or
    //    if leadId is empty (cannot persist without a lead).
    if (!draft.lines.length || !draft.leadId) return newEst;

    trpcVanilla.v1.quoting.draft
      .mutate({
        leadId: draft.leadId,
        title: draft.title ?? undefined,
        discBps: Math.round((draft.pricing?.disc ?? 0) * 100),  // percent → bps
        taxBps:  Math.round((draft.pricing?.tax  ?? 0) * 100),
        depBps:  Math.round((draft.pricing?.dep  ?? 0) * 100),
        validDays: draft.validDays ?? undefined,
        lines: draft.lines.map((l) => ({
          description: l.d,
          quantity:    l.q,
          rateCents:   Math.round(l.r * 100),            // dollars → cents
          costCents:   Math.round((l.c ?? 0) * 100),     // dollars → cents; 0 when absent
          isOptional:  l.opt ?? false,
          needsPhoto:  l.photo ?? false,
          taxable:     !l.notax,                        // absent notax = taxable
          tier:        l.tier,                           // GBB tier tag; absent on single quotes
          scope:       l.scope?.trim() ? l.scope : undefined,
          subItems:    l.sub?.length
            ? l.sub.map((si) => ({
                description: si.d,
                quantity: si.q,
                unit: si.unit,
                amountCents: Math.round(si.amt * 100),   // dollars → cents
              }))
            : undefined,
        })),
        // Good/Better/Best: the full three-tier structure persists. The server's
        // draft schema rejects inconsistent payloads (tiered lines require
        // recommendedTier and vice versa) — callers set both or neither.
        recommendedTier: draft.recommendedTier,
        tierNames: draft.tierNames,
        termsSnapshot: draft.termsSnapshot?.trim() ? draft.termsSnapshot : undefined,
        priceDisplay: draft.priceDisplay,
        presentationSnapshot: draft.presentation,
        // The scope-visit job this quote prices (composer ?job=) — accept converts that job
        // into the sold work instead of minting a duplicate.
        jobId: draft.jobId ?? undefined,
      })
      .then((dto) => {
        invalidateLists("estimates", "customers", "jobs");
        // 3. Reconcile — id stays stable (client-authored); server overwrites num.
        const reconciled = dtoEstimateToStore(dto, newEst.fu);
        // Preserve local id so reconcile doesn't orphan the optimistic record.
        const merged: Estimate = { ...reconciled, id };
        set((s) => ({ estimates: reconcileEst(s.estimates, merged) }));
      })
      .catch((err: unknown) => {
        // 4. Roll back.
        set({ estimates: prior });
        reportWriteError("addEstimate", err);
      });

    return newEst;
  },

  // ---------------------------------------------------------------------------
  // updateEstimate — routes by patch content to the appropriate backend mutation.
  //
  // Routed mutations (wired):
  //   { status: "sent" }     → v1.quoting.send
  //   { status: "accepted" } → v1.quoting.accept (with optional lines, converted to cents)
  //   { archived: true }     → v1.quoting.archive (soft-delete)
  //
  // Client-local (no network call):
  //   { status: "declined" } — use declineEstimate(id, reason) instead
  //   { fu }                 — client-local: fu is not persisted
  //   { lines }              — in-flight draft edits; committed at accept time or via re-draft
  //   other fields           — store-local for pilot
  // ---------------------------------------------------------------------------
  updateEstimate: (id, patch) => {
    const prior = snapshotEst(get().estimates, id);

    // 1. Optimistic update.
    set((s) => ({
      estimates: s.estimates.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));

    // Follow-up rides its own endpoint — it is orthogonal to status, and the send/accept/decline
    // routes below each handle exactly one transition.
    if (patch.fu) {
      const { on, stage } = patch.fu;
      void trpcVanilla.v1.quoting.setFollowUp
        .mutate({ estimateId: id, on, stage })
        .catch((err: unknown) => {
          if (prior) set((s) => ({ estimates: restoreEst(s.estimates, prior) }));
          reportWriteError("updateEstimate.followUp", err);
        });
    }

    // 2. Route to the backend mutation based on what changed.
    if (patch.status === "sent") {
      trpcVanilla.v1.quoting.send
        .mutate({ estimateId: id })
        .then((dto) => {
          invalidateLists("estimates", "customers", "jobs");
          const reconciled = dtoEstimateToStore(dto, patch.fu ?? prior?.fu ?? { on: false, stage: 0 });
          set((s) => ({ estimates: reconcileEst(s.estimates, { ...reconciled, id }) }));
        })
        .catch((err: unknown) => {
          if (prior) set((s) => ({ estimates: restoreEst(s.estimates, prior) }));
          reportWriteError("updateEstimate", err);
        });
      return;
    }

    if (patch.status === "accepted") {
      // Build the lines payload when the caller has provided customer-tuned lines.
      // Store lines are in dollars; the backend expects integer cents.
      const backendLines = patch.lines?.map((l) => ({
        description: l.d,
        quantity: l.q,
        rateCents: Math.round(l.r * 100),           // dollars → cents
        costCents: Math.round((l.c ?? 0) * 100),    // dollars → cents; 0 when absent
        isOptional: l.opt ?? false,
        needsPhoto: l.photo ?? false,
        taxable: !l.notax,
        scope: l.scope?.trim() ? l.scope : undefined,
        subItems: l.sub?.length
          ? l.sub.map((si) => ({
              description: si.d,
              quantity: si.q,
              unit: si.unit,
              amountCents: Math.round(si.amt * 100), // dollars → cents
            }))
          : undefined,
      }));

      trpcVanilla.v1.quoting.accept
        // Good/Better/Best: patch.acceptedTier carries the tier the user chose
        // in the preview — forwarded as chosenTier so the server resolves the
        // estimate to THAT tier (undefined on single quotes: unchanged path).
        .mutate({ estimateId: id, lines: backendLines, chosenTier: patch.acceptedTier })
        .then((dto) => {
          invalidateLists("estimates", "customers", "jobs");
          // Reconcile with the persisted accepted lines (including any customer-selected add-ons).
          const reconciled = dtoEstimateToStore(dto, prior?.fu ?? { on: false, stage: 0 });
          set((s) => ({ estimates: reconcileEst(s.estimates, { ...reconciled, id }) }));
          // Adopt the newly created job into the jobs slice so it appears immediately
          // without waiting for the next hydrator refetch.
          if (dto.job) {
            get().adoptJob(dto.job);
          }
        })
        .catch((err: unknown) => {
          if (prior) set((s) => ({ estimates: restoreEst(s.estimates, prior) }));
          reportWriteError("updateEstimate", err);
        });
      return;
    }

    if (patch.archived === true) {
      // Soft-delete via v1.quoting.archive. archive returns { ok } — no DTO to reconcile.
      trpcVanilla.v1.quoting.archive
        .mutate({ estimateId: id })
        .catch((err: unknown) => {
          // Roll back optimistic archived flag.
          if (prior) set((s) => ({ estimates: restoreEst(s.estimates, prior) }));
          reportWriteError("updateEstimate", err);
        });
      return;
    }

    // { status: "declined" } — caller should use declineEstimate(id, reason) instead.
    // If somehow routed here, the optimistic update already applied; no network call.

    // { fu }    — client-local: fu is not persisted; optimistic update is sufficient.
    // { lines } — in-flight draft edits; committed at accept time via accept-with-lines.
    // All other patches stay store-local for the pilot.
  },

  // ---------------------------------------------------------------------------
  // declineEstimate — dedicated action (separate from updateEstimate) because the
  // backend v1.quoting.decline requires an explicit reason string that the generic
  // patch interface cannot safely carry.
  //
  // Caller: cust-quote-modal.tsx decline() — must pass the reason from DeclineBlock.
  // ---------------------------------------------------------------------------
  declineEstimate: (id, reason) => {
    const prior = snapshotEst(get().estimates, id);

    // 1. Optimistic update.
    set((s) => ({
      estimates: s.estimates.map((e) =>
        e.id === id ? { ...e, status: "declined" } : e
      ),
    }));

    trpcVanilla.v1.quoting.decline
      .mutate({ estimateId: id, reason })
      .then((dto) => {
        invalidateLists("estimates", "customers", "jobs");
        const reconciled = dtoEstimateToStore(dto, prior?.fu ?? { on: false, stage: 0 });
        set((s) => ({ estimates: reconcileEst(s.estimates, { ...reconciled, id }) }));
      })
      .catch((err: unknown) => {
        if (prior) set((s) => ({ estimates: restoreEst(s.estimates, prior) }));
        reportWriteError("declineEstimate", err);
      });
  },

  // ---------------------------------------------------------------------------
  // recordRead / endRead — client-local: no persistence.
  // Read telemetry (the breathing dot, the "opened X ago" Rail ink) is ephemeral.
  // ---------------------------------------------------------------------------
  recordRead: (id, read) =>
    // client-local: no persistence
    set((s) => ({
      estimates: s.estimates.map((e) =>
        e.id === id ? { ...e, viewed: true, reads: [...(e.reads ?? []), read] } : e
      ),
    })),

  endRead: (id) =>
    // client-local: no persistence
    set((s) => ({
      estimates: s.estimates.map((e) =>
        e.id === id
          ? { ...e, reads: (e.reads ?? []).map((r) => (r.live ? { ...r, live: false } : r)) }
          : e
      ),
    })),

  // ---------------------------------------------------------------------------
  // restoreEstimate — wired to v1.quoting.restore (clears deleted_at).
  // Optimistic: clear archived + trash flags. Reconcile with the returned DTO
  // on success (mirrors the task/visit pattern). Roll back on error.
  // ---------------------------------------------------------------------------
  restoreEstimate: (id) => {
    const prior = snapshotEst(get().estimates, id);

    // 1. Optimistic update.
    set((s) => ({
      estimates: s.estimates.map((e) =>
        e.id === id ? { ...e, archived: false, trash: false } : e
      ),
    }));

    // 2. Persist via v1.quoting.restore — returns the full estimateDTO.
    trpcVanilla.v1.quoting.restore
      .mutate({ estimateId: id })
      .then((dto) => {
        invalidateLists("estimates", "customers", "jobs");
        const reconciled = dtoEstimateToStore(dto, prior?.fu ?? { on: false, stage: 0 });
        set((s) => ({ estimates: reconcileEst(s.estimates, { ...reconciled, id }) }));
      })
      .catch((err: unknown) => {
        if (prior) set((s) => ({ estimates: restoreEst(s.estimates, prior) }));
        reportWriteError("restoreEstimate", err);
      });
  },

  // ---------------------------------------------------------------------------
  // deleteEstimate — soft-delete via v1.quoting.archive (no hard delete).
  // Optimistic: mark archived + trash. archive returns { ok } only — no DTO.
  // Roll back on error.
  // ---------------------------------------------------------------------------
  deleteEstimate: (id) => {
    const prior = snapshotEst(get().estimates, id);

    // 1. Optimistic update.
    set((s) => ({
      estimates: s.estimates.map((e) =>
        e.id === id ? { ...e, archived: true, trash: true } : e
      ),
    }));

    // 2. Persist via v1.quoting.archive (soft-delete; no hard delete exists).
    trpcVanilla.v1.quoting.archive
      .mutate({ estimateId: id })
      .catch((err: unknown) => {
        if (prior) set((s) => ({ estimates: restoreEst(s.estimates, prior) }));
        reportWriteError("deleteEstimate", err);
      });
  },
});
