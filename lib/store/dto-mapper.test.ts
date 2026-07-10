/**
 * lib/store/dto-mapper.test.ts
 * Unit tests for dtoEstimateToStore and dtoInvoiceToStore.
 *
 * Covers:
 *   - Money unit conversion: cents → dollars (÷ 100)
 *   - Basis-points → percent conversion: bps → percent (÷ 100)
 *   - Optional fields handled correctly (zero cost → omitted, opt/photo → omitted when false)
 *   - Client-local fields preserved (fu, cust, phone, email)
 *   - origin: "db" stamped on reconciled invoices
 *   - void invoices → archived: true
 */

import { describe, it, expect } from "vitest";
import { dtoEstimateToStore, dtoInvoiceToStore, type EstimateDTO, type InvoiceDTO } from "./dto-mapper";
import type { Estimate, Invoice } from "./types";

// ---------------------------------------------------------------------------
// Minimal DTO builders (satisfy the inferred types without the full DTO shape)
// ---------------------------------------------------------------------------

function makeMoneyDTO(cents: number) {
  return { cents, currency: "USD" as const };
}

function makeEstimateDTO(overrides: Partial<EstimateDTO> = {}): EstimateDTO {
  return {
    id: "est-111",
    num: "Q-0017",
    leadId: "lead-abc",
    title: "Roof repair",
    status: "draft",
    discBps: 500,    // 5%
    taxBps: 800,     // 8%
    depBps: 2000,    // 20%
    validDays: 30,
    lines: [
      {
        id: "line-1",
        description: "Labour",
        quantity: 2,
        rate: makeMoneyDTO(7500),  // $75.00
        cost: makeMoneyDTO(3000),  // $30.00
        isOptional: false,
        needsPhoto: false,
        position: 0,
      },
      {
        id: "line-2",
        description: "Materials",
        quantity: 1,
        rate: makeMoneyDTO(5000),  // $50.00
        cost: makeMoneyDTO(0),     // $0 → should be omitted
        isOptional: true,
        needsPhoto: true,
        position: 1,
      },
    ],
    subtotal: makeMoneyDTO(20000),
    discount: makeMoneyDTO(1000),
    tax: makeMoneyDTO(1520),
    total: makeMoneyDTO(20520),   // $205.20
    depositDue: makeMoneyDTO(4104),
    sentAt: null,
    acceptedAt: null,
    declinedAt: null,
    declineReason: null,
    publicToken: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeInvoiceDTO(overrides: Partial<InvoiceDTO> = {}): InvoiceDTO {
  return {
    id: "inv-222",
    num: "INV-0099",
    sourceJobId: "job-xyz",
    leadId: "lead-abc",
    title: "Final bill",
    status: "sent",
    total: makeMoneyDTO(12000),        // $120.00
    depositPaid: makeMoneyDTO(3000),   // $30.00
    amountPaid: makeMoneyDTO(3000),
    due: makeMoneyDTO(9000),
    termsDays: 14,
    lines: [
      {
        id: "linv-1",
        description: "Service",
        quantity: 1,
        rate: makeMoneyDTO(12000),   // $120.00
        cost: makeMoneyDTO(5000),    // $50.00
        position: 0,
      },
    ],
    payments: [
      {
        id: "pay-1",
        amount: makeMoneyDTO(3000),  // $30.00
        method: "cash",
        receivedAt: "2026-06-01T10:00:00.000Z",
      },
    ],
    sentAt: "2026-06-01T09:00:00.000Z",
    dueAt: "2026-06-15T00:00:00.000Z",
    createdAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function makePriorEst(fu: Estimate["fu"] = { on: false, stage: 0 }): Estimate["fu"] {
  return fu;
}

function makePriorInv(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-222",
    num: "INV-0099",
    jobId: null,
    leadId: "lead-abc",
    cust: "Jane Doe",
    phone: "555-1234",
    email: "jane@example.com",
    title: "Final bill",
    status: "sent",
    total: 120,
    depPaid: 30,
    payments: [],
    lines: [],
    age: 2,
    archived: false,
    origin: "db",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// dtoEstimateToStore
// ---------------------------------------------------------------------------

describe("dtoEstimateToStore", () => {
  it("maps id, num, leadId, title, status correctly", () => {
    const dto = makeEstimateDTO();
    const result = dtoEstimateToStore(dto, makePriorEst());
    expect(result.id).toBe("est-111");
    expect(result.num).toBe("Q-0017");
    expect(result.leadId).toBe("lead-abc");
    expect(result.title).toBe("Roof repair");
    expect(result.status).toBe("draft");
  });

  it("converts total.cents → cachedTotal in dollars", () => {
    const dto = makeEstimateDTO({ total: makeMoneyDTO(20520) });
    const result = dtoEstimateToStore(dto, makePriorEst());
    // 20520 cents → $205.20
    expect(result.cachedTotal).toBeCloseTo(205.2);
  });

  it("converts bps → percent for pricing fields", () => {
    const dto = makeEstimateDTO({ discBps: 500, taxBps: 800, depBps: 2000 });
    const result = dtoEstimateToStore(dto, makePriorEst());
    // 500 bps → 5%, 800 bps → 8%, 2000 bps → 20%
    expect(result.pricing?.disc).toBeCloseTo(5);
    expect(result.pricing?.tax).toBeCloseTo(8);
    expect(result.pricing?.dep).toBeCloseTo(20);
  });

  it("converts line rate cents → dollars", () => {
    const dto = makeEstimateDTO();
    const result = dtoEstimateToStore(dto, makePriorEst());
    // First line: rate 7500 cents → $75.00
    expect(result.lines[0]?.r).toBeCloseTo(75);
    // Second line: rate 5000 cents → $50.00
    expect(result.lines[1]?.r).toBeCloseTo(50);
  });

  it("converts line cost cents → dollars when > 0", () => {
    const dto = makeEstimateDTO();
    const result = dtoEstimateToStore(dto, makePriorEst());
    // First line: cost 3000 cents → $30.00
    expect(result.lines[0]?.c).toBeCloseTo(30);
  });

  it("omits line cost when cost.cents === 0", () => {
    const dto = makeEstimateDTO();
    const result = dtoEstimateToStore(dto, makePriorEst());
    // Second line: cost 0 → omitted (undefined)
    expect(result.lines[1]?.c).toBeUndefined();
  });

  it("maps isOptional → opt (true only)", () => {
    const dto = makeEstimateDTO();
    const result = dtoEstimateToStore(dto, makePriorEst());
    // Line 0: isOptional = false → opt should be undefined (falsy → omitted)
    expect(result.lines[0]?.opt).toBeUndefined();
    // Line 1: isOptional = true → opt = true
    expect(result.lines[1]?.opt).toBe(true);
  });

  it("maps needsPhoto → photo (true only)", () => {
    const dto = makeEstimateDTO();
    const result = dtoEstimateToStore(dto, makePriorEst());
    // Line 0: needsPhoto = false → photo should be undefined
    expect(result.lines[0]?.photo).toBeUndefined();
    // Line 1: needsPhoto = true → photo = true
    expect(result.lines[1]?.photo).toBe(true);
  });

  it("preserves caller-supplied fu (client-local)", () => {
    const dto = makeEstimateDTO();
    const fu = { on: true, stage: 2 };
    const result = dtoEstimateToStore(dto, fu);
    expect(result.fu).toEqual(fu);
  });

  it("initialises reads to empty array (client-local — not persisted)", () => {
    const result = dtoEstimateToStore(makeEstimateDTO(), makePriorEst());
    expect(result.reads).toEqual([]);
  });

  it("sets viewed: false for draft status", () => {
    const result = dtoEstimateToStore(makeEstimateDTO({ status: "draft" }), makePriorEst());
    expect(result.viewed).toBe(false);
  });

  it("sets viewed: true for sent status", () => {
    const result = dtoEstimateToStore(makeEstimateDTO({ status: "sent" }), makePriorEst());
    expect(result.viewed).toBe(true);
  });

  it("sets viewed: true for accepted status", () => {
    const result = dtoEstimateToStore(makeEstimateDTO({ status: "accepted" }), makePriorEst());
    expect(result.viewed).toBe(true);
  });

  it("handles null title gracefully → 'Quote'", () => {
    const result = dtoEstimateToStore(makeEstimateDTO({ title: null }), makePriorEst());
    expect(result.title).toBe("Quote");
  });

  it("handles null validDays gracefully → undefined", () => {
    const result = dtoEstimateToStore(makeEstimateDTO({ validDays: null }), makePriorEst());
    expect(result.validDays).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// dtoInvoiceToStore
// ---------------------------------------------------------------------------

describe("dtoInvoiceToStore", () => {
  it("maps id, num, leadId, title, status correctly", () => {
    const result = dtoInvoiceToStore(makeInvoiceDTO(), makePriorInv());
    expect(result.id).toBe("inv-222");
    expect(result.num).toBe("INV-0099");
    expect(result.leadId).toBe("lead-abc");
    expect(result.title).toBe("Final bill");
    expect(result.status).toBe("sent");
  });

  it("converts total.cents → total in dollars", () => {
    const result = dtoInvoiceToStore(makeInvoiceDTO({ total: makeMoneyDTO(12000) }), makePriorInv());
    // 12000 cents → $120.00
    expect(result.total).toBeCloseTo(120);
  });

  it("converts depositPaid.cents → depPaid in dollars", () => {
    const result = dtoInvoiceToStore(makeInvoiceDTO({ depositPaid: makeMoneyDTO(3000) }), makePriorInv());
    // 3000 cents → $30.00
    expect(result.depPaid).toBeCloseTo(30);
  });

  it("converts payment amount.cents → Payment.amt in dollars", () => {
    const result = dtoInvoiceToStore(makeInvoiceDTO(), makePriorInv());
    expect(result.payments).toHaveLength(1);
    // 3000 cents → $30.00
    expect(result.payments[0]?.amt).toBeCloseTo(30);
  });

  it("converts line rate cents → dollars", () => {
    const result = dtoInvoiceToStore(makeInvoiceDTO(), makePriorInv());
    // 12000 cents → $120.00
    expect(result.lines[0]?.r).toBeCloseTo(120);
  });

  it("converts line cost cents → dollars when > 0", () => {
    const result = dtoInvoiceToStore(makeInvoiceDTO(), makePriorInv());
    // 5000 cents → $50.00
    expect(result.lines[0]?.c).toBeCloseTo(50);
  });

  it("omits line cost when cost.cents === 0", () => {
    const dto = makeInvoiceDTO({
      lines: [{
        id: "linv-z",
        description: "Zero cost",
        quantity: 1,
        rate: makeMoneyDTO(1000),
        cost: makeMoneyDTO(0),
        position: 0,
      }],
    });
    const result = dtoInvoiceToStore(dto, makePriorInv());
    expect(result.lines[0]?.c).toBeUndefined();
  });

  it("stamps origin: 'db' on the reconciled record", () => {
    const result = dtoInvoiceToStore(makeInvoiceDTO(), makePriorInv({ origin: "manual" }));
    expect(result.origin).toBe("db");
  });

  it("preserves cust, phone, email from priorInv (not in DTO)", () => {
    const prior = makePriorInv({ cust: "Jane Doe", phone: "555-9999", email: "jane@test.com" });
    const result = dtoInvoiceToStore(makeInvoiceDTO(), prior);
    expect(result.cust).toBe("Jane Doe");
    expect(result.phone).toBe("555-9999");
    expect(result.email).toBe("jane@test.com");
  });

  it("maps sourceJobId to jobId", () => {
    const result = dtoInvoiceToStore(makeInvoiceDTO({ sourceJobId: "job-xyz" }), makePriorInv());
    expect(result.jobId).toBe("job-xyz");
  });

  it("sets archived: true for void status", () => {
    const result = dtoInvoiceToStore(makeInvoiceDTO({ status: "void" }), makePriorInv());
    expect(result.archived).toBe(true);
  });

  it("sets archived: false for non-void status", () => {
    const result = dtoInvoiceToStore(makeInvoiceDTO({ status: "paid" }), makePriorInv());
    expect(result.archived).toBe(false);
  });

  it("handles null title gracefully → 'Invoice'", () => {
    const result = dtoInvoiceToStore(makeInvoiceDTO({ title: null }), makePriorInv());
    expect(result.title).toBe("Invoice");
  });

  it("handles null sourceJobId → jobId: null", () => {
    const result = dtoInvoiceToStore(makeInvoiceDTO({ sourceJobId: null }), makePriorInv());
    expect(result.jobId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Stage mapper (store display ↔ DB enum)
// ---------------------------------------------------------------------------

describe("stage mapper (store display ↔ DB enum)", () => {
  it("maps every display stage to its DB enum value", () => {
    expect(storeStageToBackend("New customer")).toBe("new");
    expect(storeStageToBackend("Contacted")).toBe("contacted");
    expect(storeStageToBackend("Quote Sent")).toBe("quote_sent");
    expect(storeStageToBackend("Won")).toBe("won");
    expect(storeStageToBackend("Lost")).toBe("lost");
  });

  it("passes through a value that is already a DB enum (idempotent)", () => {
    expect(storeStageToBackend("quote_sent")).toBe("quote_sent");
    expect(storeStageToBackend("new")).toBe("new");
  });

  it("falls back to 'new' for an unknown stage string", () => {
    expect(storeStageToBackend("Totally unknown")).toBe("new");
  });

  it("maps every DB enum value back to its display stage", () => {
    expect(backendStageToStore("new")).toBe("New customer");
    expect(backendStageToStore("contacted")).toBe("Contacted");
    expect(backendStageToStore("quote_sent")).toBe("Quote Sent");
    expect(backendStageToStore("won")).toBe("Won");
    expect(backendStageToStore("lost")).toBe("Lost");
  });

  it("round-trips display → backend → display for all five stages", () => {
    for (const s of ["New customer", "Contacted", "Quote Sent", "Won", "Lost"]) {
      expect(backendStageToStore(storeStageToBackend(s))).toBe(s);
    }
  });

  it("passes through an already-display value in backendStageToStore", () => {
    expect(backendStageToStore("Quote Sent")).toBe("Quote Sent");
  });
});

import { storeStageToBackend, backendStageToStore } from "./dto-mapper";
