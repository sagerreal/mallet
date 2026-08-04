import { describe, it, expect } from "vitest";
import { termsLine } from "./terms-line";

describe("termsLine", () => {
  it("Net + due + PO — the full shape", () => {
    expect(
      termsLine({ termsDays: 30, dueAt: "2026-09-02T18:00:00.000Z", poNumber: "4471" }),
    ).toBe("Net 30 · due Sep 2 · PO 4471");
  });

  it("Net + due, no PO", () => {
    expect(termsLine({ termsDays: 30, dueAt: "2026-09-02T18:00:00.000Z", poNumber: null })).toBe(
      "Net 30 · due Sep 2",
    );
  });

  it("on-receipt (termsDays 0) still shows the due date, but no 'Net 0'", () => {
    expect(termsLine({ termsDays: 0, dueAt: "2026-09-02T18:00:00.000Z", poNumber: null })).toBe(
      "due Sep 2",
    );
  });

  it("draft, never sent (no dueAt) with real terms shows Net alone", () => {
    expect(termsLine({ termsDays: 30, dueAt: null, poNumber: null })).toBe("Net 30");
  });

  it("on-receipt, never sent, but a PO was supplied shows PO alone", () => {
    expect(termsLine({ termsDays: 0, dueAt: null, poNumber: "4471" })).toBe("PO 4471");
  });

  it("empty string when there is nothing to say", () => {
    expect(termsLine({ termsDays: 0, dueAt: null, poNumber: null })).toBe("");
    expect(termsLine({ termsDays: null, dueAt: undefined, poNumber: undefined })).toBe("");
  });

  it("blank/whitespace-only PO is treated as absent", () => {
    expect(termsLine({ termsDays: 0, dueAt: null, poNumber: "   " })).toBe("");
  });

  it("negative or null termsDays never renders Net", () => {
    expect(termsLine({ termsDays: -1, dueAt: null, poNumber: null })).toBe("");
    expect(termsLine({ termsDays: undefined, dueAt: "2026-09-02T18:00:00.000Z", poNumber: null })).toBe(
      "due Sep 2",
    );
  });

  it("the default termsDays of 7 still renders Net (not treated as 'nothing to say')", () => {
    expect(termsLine({ termsDays: 7, dueAt: null, poNumber: null })).toBe("Net 7");
  });
});
