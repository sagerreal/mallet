/**
 * lib/store/slices/ui-slice.test.ts
 * The modal back-stack contract (P6/6): a drill-in (pushModal) remembers its
 * parent; closeModal restores the parent instead of dead-ending; a root open
 * (openModal) resets the stack so stale parents can never resurface.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";

function ui() {
  return useAppStore.getState();
}

describe("ui-slice modal back-stack", () => {
  beforeEach(() => {
    useAppStore.setState({ activeModal: null, modalStack: [] });
  });

  it("openModal is a root open — replaces and clears any stack", () => {
    ui().openModal(MODAL.LEAD, { leadId: "l1" });
    ui().pushModal(MODAL.CALL, { leadId: "l1" });
    ui().openModal(MODAL.JOB, { jobId: "j1" });
    expect(ui().activeModal).toEqual({ id: MODAL.JOB, params: { jobId: "j1" } });
    expect(ui().modalStack).toEqual([]);
  });

  it("pushModal remembers the parent; closeModal restores it with its params", () => {
    ui().openModal(MODAL.LEAD, { leadId: "l1" });
    ui().pushModal(MODAL.CALL, { leadId: "l1" });
    expect(ui().activeModal?.id).toBe(MODAL.CALL);
    ui().closeModal();
    expect(ui().activeModal).toEqual({ id: MODAL.LEAD, params: { leadId: "l1" } });
    ui().closeModal();
    expect(ui().activeModal).toBeNull();
    expect(ui().modalStack).toEqual([]);
  });

  it("pushModal with nothing open behaves like a root open", () => {
    ui().pushModal(MODAL.CALL, { leadId: "l1" });
    expect(ui().activeModal?.id).toBe(MODAL.CALL);
    ui().closeModal();
    expect(ui().activeModal).toBeNull();
  });

  it("dismissModals clears the whole stack in ONE action, whatever its depth", () => {
    // A TERMINAL step (the field close-out's Done) must leave nothing behind. Popping N times
    // guesses the depth, and the depth is not fixed — the visit-fee path pushes an extra level.
    ui().openModal(MODAL.TECH_JOB, { jobId: "j1" });
    ui().pushModal(MODAL.CLOSE_OUT, { jobId: "j1", from: "field-job" });
    ui().pushModal(MODAL.INVOICE, { invoiceId: "i1" });
    ui().dismissModals();
    expect(ui().activeModal).toBeNull();
    expect(ui().modalStack).toEqual([]);
  });

  it("dismissModals from a single root leaves nothing open", () => {
    ui().openModal(MODAL.TECH_JOB, { jobId: "j1" });
    ui().dismissModals();
    expect(ui().activeModal).toBeNull();
    expect(ui().modalStack).toEqual([]);
  });

  it("two-level drill-in pops in order (job → price builder → back to job)", () => {
    ui().openModal(MODAL.JOB, { jobId: "j1" });
    ui().pushModal(MODAL.PRICE_BUILDER, { jobId: "j1" });
    ui().pushModal(MODAL.CALL, { leadId: "l1" });
    ui().closeModal();
    expect(ui().activeModal?.id).toBe(MODAL.PRICE_BUILDER);
    ui().closeModal();
    expect(ui().activeModal).toEqual({ id: MODAL.JOB, params: { jobId: "j1" } });
  });
});
