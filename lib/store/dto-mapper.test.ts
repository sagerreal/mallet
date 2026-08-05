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
 *   - dtoFieldInvoiceToStore: the technician's read path — the balance always survives, the line
 *     breakdown follows the shop's techSeesPrice, and cost never reaches the store at all
 */

import { describe, it, expect } from "vitest";
import { dtoEstimateToStore, dtoFieldInvoiceToStore, dtoInvoiceToStore, dtoJobToStoreJob, mapExecution, toStoreVisit, storeStageToBackend, backendStageToStore, type EstimateDTO, type FieldInvoiceDTO, type InvoiceDTO } from "./dto-mapper";
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
    followUpOn: false,
    followUpStage: 0,
    discBps: 500,    // 5%
    taxBps: 800,     // 8%
    depBps: 2000,    // 20%
    validDays: 30,
    jobId: null,
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
        tier: null,
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
        tier: null,
      },
    ],
    subtotal: makeMoneyDTO(20000),
    discount: makeMoneyDTO(1000),
    tax: makeMoneyDTO(1520),
    total: makeMoneyDTO(20520),   // $205.20
    depositDue: makeMoneyDTO(4104),
    depositPaid: makeMoneyDTO(0),
    sentAt: null,
    acceptedAt: null,
    declinedAt: null,
    declineReason: null,
    changeRequestedAt: null,
    changeRequest: null,
    recommendedTier: null,
    acceptedTier: null,
    tierNames: null,
    termsSnapshot: null,
    publicToken: null,
    publicUrl: null,
    signature: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeInvoiceDTO(overrides: Partial<InvoiceDTO> = {}): InvoiceDTO {
  return {
    id: "inv-222",
    num: "INV-0099",
    followUpOn: false,
    followUpStage: 0,
    sourceJobId: "job-xyz",
    authorization: null,
    leadId: "lead-abc",
    customerName: "Sofia Hernandez",
    serviceAddress: "18 Aspen Ct, Dublin, CA 94568",
    serviceAt: "2026-08-03T16:20:00.000Z",
    title: "Final bill",
    status: "sent",
    total: makeMoneyDTO(12000),        // $120.00 — TAX-INCLUSIVE
    taxBps: 875,                       // 8.75%
    tax: makeMoneyDTO(965),            // the part of the $120 that is tax
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
    poNumber: null,
    publicToken: null,
    publicUrl: null,
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

  // fu comes from the SERVER now. It used to be client-local, and the hydrator reset it to off on
  // every refetch — so a follow-up the user switched on read back off.
  it("takes fu from the DTO, not the caller", () => {
    const dto = makeEstimateDTO({ followUpOn: true, followUpStage: 2 });
    const result = dtoEstimateToStore(dto, { on: false, stage: 0 });
    expect(result.fu).toEqual({ on: true, stage: 2 });
  });

  // The fallback still matters: an optimistic toggle the response has not caught up with.
  it("falls back to the caller's fu when the DTO carries none", () => {
    const dto = makeEstimateDTO();
    delete (dto as { followUpOn?: boolean }).followUpOn;
    expect(dtoEstimateToStore(dto, { on: true, stage: 1 }).fu).toEqual({ on: true, stage: 1 });
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

  it("maps publicToken string to store", () => {
    const result = dtoEstimateToStore(makeEstimateDTO({ publicToken: "tok_abc123" }), makePriorEst());
    expect(result.publicToken).toBe("tok_abc123");
  });

  it("maps null publicToken → undefined (absent from store)", () => {
    const result = dtoEstimateToStore(makeEstimateDTO({ publicToken: null }), makePriorEst());
    expect(result.publicToken).toBeUndefined();
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

  it("takes the customer NAME off the wire and keeps phone/email from priorInv", () => {
    // The ledger pages through the database, so the store's copy of a name can be stale or absent
    // — and this name is printed on the customer's own copy of the bill. phone/email are still
    // not on this DTO, so those stay with the prior record.
    const prior = makePriorInv({ cust: "Jane Doe", phone: "555-9999", email: "jane@test.com" });
    const result = dtoInvoiceToStore(makeInvoiceDTO(), prior);
    expect(result.cust).toBe("Sofia Hernandez");
    expect(result.phone).toBe("555-9999");
    expect(result.email).toBe("jane@test.com");
  });

  it("falls back to the prior name only when the server has none — a deleted lead", () => {
    const prior = makePriorInv({ cust: "Jane Doe" });
    const result = dtoInvoiceToStore(makeInvoiceDTO({ customerName: null }), prior);
    expect(result.cust).toBe("Jane Doe");
  });

  it("carries the document facts: the invoice date, the service address and the service date", () => {
    const result = dtoInvoiceToStore(makeInvoiceDTO(), makePriorInv());
    expect(result.createdAt).toBe("2026-06-01T00:00:00.000Z");
    expect(result.serviceAddress).toBe("18 Aspen Ct, Dublin, CA 94568");
    expect(result.serviceAt).toBe("2026-08-03T16:20:00.000Z");
  });

  it("keeps an unknown service date NULL — never the invoice date under a Service label", () => {
    const result = dtoInvoiceToStore(makeInvoiceDTO({ serviceAt: null }), makePriorInv());
    expect(result.serviceAt).toBeNull();
    expect(result.createdAt).toBe("2026-06-01T00:00:00.000Z");
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

// ---------------------------------------------------------------------------
// dtoJobToStoreJob — svc mapping (Task 6)
// ---------------------------------------------------------------------------

const baseJobDto = {
  id: "11111111-1111-1111-1111-111111111111",
  num: "JOB-1",
  leadId: "33333333-3333-3333-3333-333333333333",
  sourceEstimateId: null,
  assigneeUserId: null,
  title: "Water heater",
  status: "scheduled" as const,
  scheduledStart: null, scheduledEnd: null, startedAt: null, completedAt: null,
  canceledAt: null, cancelReason: null,
  total: { cents: 0, currency: "USD" as const },
  notes: "gate 4",
  svc: "estimate",
  visits: [],
  createdAt: "2026-07-10T00:00:00.000Z",
};

describe("dtoJobToStoreJob svc mapping", () => {
  it("reads svc from the DTO", () => {
    const job = dtoJobToStoreJob(baseJobDto as never);
    expect(job.svc).toBe("estimate");
  });

  it("falls back to 'service' when svc is null", () => {
    const job = dtoJobToStoreJob({ ...baseJobDto, svc: null } as never);
    expect(job.svc).toBe("service");
  });
});

// ---------------------------------------------------------------------------
// dtoJobToStoreJob — sourceEstimateId threading
// ---------------------------------------------------------------------------

describe("dtoJobToStoreJob sourceEstimateId threading", () => {
  it("threads a non-null sourceEstimateId through to the store job", () => {
    const estId = "aaaabbbb-cccc-dddd-eeee-ffffffffffff";
    const job = dtoJobToStoreJob({ ...baseJobDto, sourceEstimateId: estId } as never);
    expect(job.sourceEstimateId).toBe(estId);
  });

  it("maps null sourceEstimateId to null on the store job", () => {
    const job = dtoJobToStoreJob({ ...baseJobDto, sourceEstimateId: null } as never);
    expect(job.sourceEstimateId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// dtoJobToStoreJob — status remap (Fix 1)
// Zero active visits + backend "scheduled" → store "unscheduled"
// ---------------------------------------------------------------------------

const visitDTO = {
  id: "vis-1",
  assigneeUserId: "tech-1",
  scheduledDate: "2026-07-15",
  scheduledStart: "09:00",
  scheduledEnd: "11:00",
  durationMinutes: null,
  status: "pending" as const,
  enrouteAt: null as string | null,
  startedAt: null,
  completedAt: null,
  notes: null,
  position: 0,
};

describe("dtoJobToStoreJob status remap (zero-visit fix)", () => {
  it("zero active visits + backend 'scheduled' → store 'unscheduled'", () => {
    const job = dtoJobToStoreJob({ ...baseJobDto, status: "scheduled", visits: [] } as never);
    expect(job.status).toBe("unscheduled");
  });

  it("zero active visits + backend 'in_progress' → store 'scheduled' (not remapped)", () => {
    const job = dtoJobToStoreJob({ ...baseJobDto, status: "in_progress", visits: [] } as never);
    expect(job.status).toBe("scheduled");
  });

  it("zero active visits + backend 'complete' → store 'done'", () => {
    const job = dtoJobToStoreJob({ ...baseJobDto, status: "complete", visits: [] } as never);
    expect(job.status).toBe("done");
  });

  it("with placed visits + backend 'scheduled' → recalcStatus (stays 'scheduled')", () => {
    const job = dtoJobToStoreJob({ ...baseJobDto, status: "scheduled", visits: [visitDTO] } as never);
    // A placed visit (date+tech+start all present) with pending status → recalcStatus → "scheduled"
    expect(job.status).toBe("scheduled");
  });

  it("canceled visit is filtered out → treated as zero active visits → 'unscheduled'", () => {
    const canceledVisit = { ...visitDTO, status: "canceled" as const };
    const job = dtoJobToStoreJob({ ...baseJobDto, status: "scheduled", visits: [canceledVisit] } as never);
    expect(job.status).toBe("unscheduled");
  });
});

// ---------------------------------------------------------------------------
// dtoJobToStoreJob — terminal backend status wins over visit placement
// (money-on-the-floor fix: a complete job with an unplaced visit was reading
// back as "unscheduled" and vanishing from Money's ready-to-bill list)
// ---------------------------------------------------------------------------

describe("dtoJobToStoreJob terminal status wins over visit-placement recalc", () => {
  it("job 'complete' + one complete but UNPLACED visit → store 'done' (the regression)", () => {
    const unplacedCompleteVisit = {
      ...visitDTO,
      status: "complete" as const,
      scheduledDate: null,
      scheduledStart: null,
      scheduledEnd: null,
    };
    const job = dtoJobToStoreJob({
      ...baseJobDto,
      status: "complete",
      visits: [unplacedCompleteVisit],
    } as never);
    expect(job.status).toBe("done");
  });

  it("job 'complete' + one PLACED complete visit → store 'done' (unchanged)", () => {
    const placedCompleteVisit = { ...visitDTO, status: "complete" as const };
    const job = dtoJobToStoreJob({
      ...baseJobDto,
      status: "complete",
      visits: [placedCompleteVisit],
    } as never);
    expect(job.status).toBe("done");
  });

  it("job 'scheduled' + an unplaced visit → store 'unscheduled' (unchanged — placement derivation survives for non-terminal jobs)", () => {
    const unplacedVisit = { ...visitDTO, scheduledDate: null, scheduledStart: null, scheduledEnd: null };
    const job = dtoJobToStoreJob({
      ...baseJobDto,
      status: "scheduled",
      visits: [unplacedVisit],
    } as never);
    expect(job.status).toBe("unscheduled");
  });

  it("job 'canceled' + an unplaced pending visit → store 'done' (terminal wins)", () => {
    const unplacedVisit = { ...visitDTO, scheduledDate: null, scheduledStart: null, scheduledEnd: null };
    const job = dtoJobToStoreJob({
      ...baseJobDto,
      status: "canceled",
      visits: [unplacedVisit],
    } as never);
    expect(job.status).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// toStoreVisit — dur precedence (duration_minutes fix)
// durationMinutes is authoritative; the start→end window is the legacy fallback.
// ---------------------------------------------------------------------------

describe("toStoreVisit dur precedence", () => {
  it("prefers durationMinutes over the start→end window", () => {
    const v = toStoreVisit({ ...visitDTO, durationMinutes: 90 } as never);
    expect(v.dur).toBe(1.5); // NOT the 2h window 09:00→11:00
  });

  it("uses durationMinutes for an unplaced visit (no window at all)", () => {
    const v = toStoreVisit({
      ...visitDTO,
      assigneeUserId: null,
      scheduledDate: null,
      scheduledStart: null,
      scheduledEnd: null,
      durationMinutes: 30,
    } as never);
    expect(v.dur).toBe(0.5);
  });

  it("falls back to hoursBetween(start, end) when durationMinutes is null (legacy row)", () => {
    const v = toStoreVisit({ ...visitDTO, durationMinutes: null } as never);
    expect(v.dur).toBe(2); // 09:00 → 11:00
  });

  it("falls back to the 2h default when durationMinutes is null and there is no window", () => {
    const v = toStoreVisit({
      ...visitDTO,
      scheduledStart: null,
      scheduledEnd: null,
      durationMinutes: null,
    } as never);
    expect(v.dur).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// toStoreVisit — "enroute" is DERIVED from the enroute_at stamp, not a backend
// status. This derivation is the only thing that makes "On my way" survive a reload.
// ---------------------------------------------------------------------------

const ENROUTE_AT = "2026-07-15T08:40:00.000Z";

describe("toStoreVisit enroute derivation", () => {
  it("pending + an enrouteAt stamp → 'enroute'", () => {
    const v = toStoreVisit({ ...visitDTO, status: "pending", enrouteAt: ENROUTE_AT } as never);
    expect(v.status).toBe("enroute");
  });

  it("pending with no stamp → 'scheduled'", () => {
    const v = toStoreVisit({ ...visitDTO, status: "pending", enrouteAt: null } as never);
    expect(v.status).toBe("scheduled");
  });

  it("in_progress with a stamp → 'onsite' (arrival outranks the trip)", () => {
    const v = toStoreVisit({ ...visitDTO, status: "in_progress", enrouteAt: ENROUTE_AT } as never);
    expect(v.status).toBe("onsite");
  });

  it("complete with a stamp → 'done'", () => {
    const v = toStoreVisit({ ...visitDTO, status: "complete", enrouteAt: ENROUTE_AT } as never);
    expect(v.status).toBe("done");
  });

  it("a DTO with no enrouteAt field at all reads as 'scheduled', not enroute", () => {
    // Guards the legacy/partial-DTO path: undefined must not be truthy-tested into a trip.
    const { enrouteAt: _dropped, ...withoutStamp } = visitDTO;
    const v = toStoreVisit({ ...withoutStamp, status: "pending" } as never);
    expect(v.status).toBe("scheduled");
  });
});

// ---------------------------------------------------------------------------
// toStoreVisit — the step STAMPS. The mapper used to drop all three even though the DTO has
// carried them since the columns landed, so the client could say which state a visit was in but
// never when it got there, and the job sheet's stepper had no times to print.
// ---------------------------------------------------------------------------

describe("toStoreVisit step stamps", () => {
  const STARTED_AT = "2026-07-15T09:02:00.000Z";
  const COMPLETED_AT = "2026-07-15T10:44:00.000Z";

  it("carries enrouteAt / startedAt / completedAt through verbatim", () => {
    const v = toStoreVisit({
      ...visitDTO,
      status: "complete",
      enrouteAt: ENROUTE_AT,
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
    } as never);
    expect(v.enrouteAt).toBe(ENROUTE_AT);
    expect(v.startedAt).toBe(STARTED_AT);
    expect(v.completedAt).toBe(COMPLETED_AT);
  });

  // NULL IS THE ANSWER, not a gap to fill. A visit completed without the intermediate taps has
  // no arrival on record and the stepper must be able to say so.
  it("keeps a null stamp null — the mapper never backfills an arrival nobody tapped", () => {
    const v = toStoreVisit({ ...visitDTO, status: "complete" } as never);
    expect(v.enrouteAt).toBeNull();
    expect(v.startedAt).toBeNull();
    expect(v.completedAt).toBeNull();
  });

  it("normalises an absent field to null rather than undefined", () => {
    const { startedAt: _a, completedAt: _b, ...partial } = visitDTO;
    const v = toStoreVisit({ ...partial, status: "pending" } as never);
    expect(v.startedAt).toBeNull();
    expect(v.completedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapExecution — server-redacted money (tech field surface)
// ---------------------------------------------------------------------------

describe("mapExecution (redacted money)", () => {
  const line = (rate: { cents: number } | null, cost: { cents: number } | null) => ({
    description: "Panel swap",
    quantity: 2,
    rate,
    cost,
  });
  const addon = (rate: { cents: number } | null, cost: { cents: number } | null) => ({
    id: "a1",
    description: "Extra outlet",
    quantity: 1,
    rate,
    cost,
    isOptional: false,
    invoiceSkip: false,
    status: "proposed" as const,
    position: 0,
  });

  it("maps rate cents → dollars when present", () => {
    const out = mapExecution({ lines: [line({ cents: 5000 }, { cents: 1000 })] });
    expect(out.lines[0]?.r).toBe(50);
    expect(out.lines[0]?.c).toBe(10);
  });

  it("maps a server-redacted (null) rate to null — never 0", () => {
    const out = mapExecution({
      lines: [line(null, null)],
      addons: [addon(null, null)],
    });
    expect(out.lines[0]?.r).toBeNull();
    expect(out.lines[0]?.c).toBeUndefined();
    expect(out.addons[0]?.r).toBeNull();
    expect(out.addons[0]?.c).toBeUndefined();
  });

  it("omits cost when the server redacts it but keeps a visible rate", () => {
    const out = mapExecution({ addons: [addon({ cents: 9000 }, null)] });
    expect(out.addons[0]?.r).toBe(90);
    expect(out.addons[0]?.c).toBeUndefined();
  });
});

describe("dtoInvoiceToStore — the recorded tax split", () => {
  /**
   * The invoice modal used to compute its Tax row with calcQuote over the LINES. An invoice raised
   * from a quote carries the agreed total with no lines at all, so that rendered "Tax 8.75%
   * +$0.00" beneath a four-figure total. The recorded amount has to reach the store for the row to
   * be able to tell the truth.
   */
  it("carries the recorded tax amount, in dollars", () => {
    const inv = dtoInvoiceToStore(makeInvoiceDTO(), makePriorInv());
    expect(inv.tax).toBe(9.65);
  });

  it("carries the rate as a percent for the label", () => {
    const inv = dtoInvoiceToStore(makeInvoiceDTO(), makePriorInv());
    expect(inv.pricing?.tax).toBe(8.75);
  });

  // The tax is already inside the total — recording the split must not move what is owed.
  it("leaves the total alone", () => {
    const inv = dtoInvoiceToStore(makeInvoiceDTO(), makePriorInv());
    expect(inv.total).toBe(120);
  });

  it("reports no tax when none was recorded, rather than guessing from lines", () => {
    const dto = makeInvoiceDTO({ taxBps: 0, tax: makeMoneyDTO(0) });
    const inv = dtoInvoiceToStore(dto, makePriorInv());
    expect(inv.tax).toBe(0);
    expect(inv.pricing?.tax).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// dtoFieldInvoiceToStore — the TECHNICIAN's read path.
//
// The owner's rule, in one sentence: a technician assigned to the job always reads the money they
// are collecting (total, balance, the payments already taken), the per-line RATE still follows the
// shop's techSeesPrice, and line COST is never theirs at any setting. These tests are the client
// half of that rule; modules/invoicing/api/field-invoice-dto.test.ts is the wire half.
// ---------------------------------------------------------------------------

function makeFieldInvoiceDTO(overrides: Partial<FieldInvoiceDTO> = {}): FieldInvoiceDTO {
  return {
    id: "inv-333",
    num: "INV-0810",
    sourceJobId: "job-xyz",
    scopeJobId: null,
    leadId: "lead-abc",
    customerName: "Sofia Hernandez",
    serviceAddress: "18 Aspen Ct, Dublin, CA 94568",
    serviceAt: "2026-08-03T16:20:00.000Z",
    title: "Water heater",
    status: "sent",
    total: makeMoneyDTO(84_000),      // $840.00
    tax: makeMoneyDTO(0),
    depositPaid: makeMoneyDTO(0),
    amountPaid: makeMoneyDTO(0),
    due: makeMoneyDTO(84_000),
    termsDays: 0,
    lines: [
      { id: "linv-1", description: "Water heater — 40 gal", quantity: 1, rate: makeMoneyDTO(84_000), position: 0 },
    ],
    payments: [],
    sentAt: "2026-08-01T09:00:00.000Z",
    dueAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("dtoFieldInvoiceToStore — the money a technician may always read", () => {
  it("carries the total, the balance and what has been paid", () => {
    const inv = dtoFieldInvoiceToStore(
      makeFieldInvoiceDTO({
        depositPaid: makeMoneyDTO(10_000),
        amountPaid: makeMoneyDTO(25_000),
        due: makeMoneyDTO(59_000),
      }),
    );
    expect(inv.total).toBe(840);
    expect(inv.due).toBe(590);
    expect(inv.depPaid).toBe(100);
    expect(inv.paidTotal).toBe(250);
  });

  it("carries each payment's amount and method — the receipt a customer is owed at the door", () => {
    const inv = dtoFieldInvoiceToStore(
      makeFieldInvoiceDTO({
        status: "paid",
        amountPaid: makeMoneyDTO(84_000),
        due: makeMoneyDTO(0),
        payments: [
          { id: "pay-1", amount: makeMoneyDTO(84_000), method: "cash", receivedAt: "2026-08-01T17:05:00.000Z" },
        ],
      }),
    );
    expect(inv.payments).toHaveLength(1);
    expect(inv.payments[0]?.amt).toBe(840);
    expect(inv.payments[0]?.method).toBe("cash");
  });

  it("stamps origin db and marks a void invoice archived, like its office twin", () => {
    expect(dtoFieldInvoiceToStore(makeFieldInvoiceDTO()).origin).toBe("db");
    expect(dtoFieldInvoiceToStore(makeFieldInvoiceDTO({ status: "void" })).archived).toBe(true);
  });

  // scopeJobId authorizes the fee; it is not the job whose bill this is. Folding it into the
  // store's jobId would make every surface that looks a job's invoice up by jobId find the fee.
  it("never lets the authorizing scope job masquerade as the bill's own job", () => {
    const inv = dtoFieldInvoiceToStore(
      makeFieldInvoiceDTO({ sourceJobId: null, scopeJobId: "job-xyz", title: "Visit fee — service call" }),
    );
    expect(inv.jobId).toBeNull();
  });

  // A technician's store holds no invoices (the hydrator is !isTech-gated), so the raise adopts a
  // record this device has never seen. The mapper has to survive that.
  it("maps with no prior record at all", () => {
    const inv = dtoFieldInvoiceToStore(makeFieldInvoiceDTO());
    expect(inv.cust).toBe("Sofia Hernandez");
    expect(inv.phone).toBe("");
    expect(inv.email).toBeUndefined();
  });
});

describe("dtoFieldInvoiceToStore — cost is never a technician's business", () => {
  // The wire shape has no `cost` key at all, so the only way one could reach the store is if this
  // mapper invented it. Assert the absence of the key, not merely a falsy value: a `c: 0` would
  // render as a real $0 cost in any surface that prints it.
  it("puts no cost on any mapped line, prices visible", () => {
    const inv = dtoFieldInvoiceToStore(makeFieldInvoiceDTO());
    expect(inv.lines).toHaveLength(1);
    for (const line of inv.lines) {
      expect(Object.keys(line).sort()).toEqual(["d", "q", "r"]);
      expect("c" in line).toBe(false);
    }
  });

  it("carries no cost through from a prior office-shaped record either", () => {
    const prior = makePriorInv({ lines: [{ d: "Water heater — 40 gal", q: 1, r: 840, c: 500 }] });
    const inv = dtoFieldInvoiceToStore(makeFieldInvoiceDTO(), prior);
    expect(inv.lines.every((l) => !("c" in l))).toBe(true);
  });
});

describe("dtoFieldInvoiceToStore — a hide-prices shop", () => {
  const hidden = () =>
    makeFieldInvoiceDTO({
      lines: [
        { id: "linv-1", description: "Water heater — 40 gal", quantity: 1, rate: null, position: 0 },
        { id: "linv-2", description: "Haul-away", quantity: 1, rate: null, position: 1 },
      ],
    });

  // The balance is the whole reason the technician is standing there. It is never redacted.
  it("still carries the balance the technician has to collect", () => {
    const inv = dtoFieldInvoiceToStore(hidden());
    expect(inv.total).toBe(840);
    expect(inv.due).toBe(840);
  });

  // A nulled rate has no honest home in the store's InvoiceLine (`r` is a plain number), and
  // writing 0 would print a fabricated price on a customer-facing bill. Drop the breakdown.
  it("drops the line breakdown rather than printing a nulled rate as $0", () => {
    const inv = dtoFieldInvoiceToStore(hidden());
    expect(inv.lines).toEqual([]);
  });

  it("drops the WHOLE breakdown when even one rate is hidden — never a partial bill", () => {
    const dto = makeFieldInvoiceDTO({
      lines: [
        { id: "linv-1", description: "Water heater — 40 gal", quantity: 1, rate: makeMoneyDTO(80_000), position: 0 },
        { id: "linv-2", description: "Haul-away", quantity: 1, rate: null, position: 1 },
      ],
    });
    expect(dtoFieldInvoiceToStore(dto).lines).toEqual([]);
  });

  // Hidden is not free: a real $0 line arrives as {cents: 0} and must survive as a $0 line.
  it("keeps a genuine $0 line — {cents: 0} is not the redaction signal", () => {
    const dto = makeFieldInvoiceDTO({
      lines: [
        { id: "linv-1", description: "Warranty callback", quantity: 1, rate: makeMoneyDTO(0), position: 0 },
      ],
    });
    expect(dtoFieldInvoiceToStore(dto).lines).toEqual([{ d: "Warranty callback", q: 1, r: 0 }]);
  });

  // The prior record on this device may hold a fully-priced breakdown from before the setting was
  // turned off. It must not be carried forward as if the server had just sent it.
  it("does not fall back to a prior record's visible lines", () => {
    const prior = makePriorInv({ lines: [{ d: "Water heater — 40 gal", q: 1, r: 840 }] });
    expect(dtoFieldInvoiceToStore(hidden(), prior).lines).toEqual([]);
  });
});
