/**
 * RecordEstimateDepositUseCase — the ONLY path that records a collected quote deposit.
 *
 * Task 4 deleted the fake stamping at accept, so a deposit is zero until money actually lands.
 * The first version of this recorder then guarded on the AMOUNT (`dep_paid_cents < incoming`),
 * which cannot work: by amount, ONE payment delivered twice and TWO DIFFERENT payments on one
 * quote are indistinguishable. `SET` silently erased the smaller of two real deposits; `+=` would
 * have double-counted a redelivery. So the guard is now payment IDENTITY — an append-only ledger
 * keyed on the settling payment_intent id, with dep_paid_cents derived as its SUM.
 *
 * This suite pins that distinction from both sides, because getting either wrong loses real money.
 */
import { describe, it, expect } from "vitest";
import { asOrgId, asEstimateId, FixedClock, isOk, money } from "@mallet/shared/types";
import { InMemoryEventBus } from "@mallet/shared/ports";
import { RecordEstimateDepositUseCase } from "./record-estimate-deposit";
import {
  ORG,
  EST,
  LEAD,
  acceptedEstimate,
  estimateLine,
  FakeDepositLedger,
} from "./quote-deposit.fixtures";

const NOW = new Date("2026-06-03T00:00:00Z");
const clock = new FixedClock(NOW);
const PI_A = "pi_aaaaaaaaaaaa";
const PI_B = "pi_bbbbbbbbbbbb";

const setup = (estimate = acceptedEstimate(), beforeAppend?: () => void) => {
  const store = { estimate };
  const ledger = new FakeDepositLedger(store, beforeAppend);
  const bus = new InMemoryEventBus();
  const useCase = new RecordEstimateDepositUseCase(
    { findById: async (id) => (id === store.estimate.props.id ? store.estimate : null) },
    ledger,
    bus,
    clock,
  );
  return { store, ledger, bus, useCase };
};

const deposit = (amountCents: number, paymentRef: string) => ({
  orgId: ORG,
  estimateId: EST,
  amountCents,
  paymentRef,
});

describe("RecordEstimateDepositUseCase", () => {
  it("accepting a 30% quote leaves depPaid at 0 — the deposit is an ask, not a receipt", () => {
    const sent = acceptedEstimate({ status: "sent", acceptedAt: null });
    const accepted = sent.accept(NOW);
    expect(isOk(accepted)).toBe(true);
    if (!isOk(accepted)) return;
    expect(accepted.value.depositDue()).toBe(30_000); // 30% of $1,000
    expect(accepted.value.props.depPaid).toBe(0);
  });

  it("records the payment on the ledger and emits estimate.deposit.paid", async () => {
    const { store, ledger, bus, useCase } = setup();

    const result = await useCase.exec(deposit(30_000, PI_A));

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.recorded).toBe(true);
    expect(result.value.depositPaidCents).toBe(30_000);
    expect(store.estimate.props.depPaid).toBe(30_000);
    expect(ledger.rows).toEqual([{ paymentRef: PI_A, amountCents: 30_000 }]);
    expect(bus.recorded).toEqual([
      {
        name: "estimate.deposit.paid",
        orgId: ORG,
        payload: {
          estimateId: EST,
          leadId: LEAD,
          amountCents: 30_000,
          depositPaidCents: 30_000,
          depositDueCents: 30_000,
          paymentRef: PI_A,
        },
        occurredAt: NOW,
      },
    ]);
  });

  // ── the two cases a bare integer cannot tell apart ────────────────────────────

  it("SAME payment delivered twice: one ledger row, one event, total unchanged", async () => {
    const { store, ledger, bus, useCase } = setup();

    const first = await useCase.exec(deposit(30_000, PI_A));
    const second = await useCase.exec(deposit(30_000, PI_A));

    expect(isOk(first) && first.value.recorded).toBe(true);
    expect(isOk(second) && second.value.recorded).toBe(false);
    // Not an error: the money IS on the quote — it just wasn't recorded twice.
    expect(isOk(second) && second.value.depositPaidCents).toBe(30_000);
    expect(store.estimate.props.depPaid).toBe(30_000); // not 60_000
    expect(ledger.rows).toHaveLength(1);
    expect(bus.recorded).toHaveLength(1);
  });

  it("TWO DIFFERENT payments: both rows kept and the total ACCUMULATES", async () => {
    // The scenario the amount guard lost: two real deposits on one quote. Under `SET` the second
    // erased the first (or was dropped as "already >= that amount"); here both are the customer's
    // money and both must survive.
    const { store, ledger, bus, useCase } = setup();

    const first = await useCase.exec(deposit(30_000, PI_A));
    const second = await useCase.exec(deposit(60_000, PI_B));

    expect(isOk(first) && first.value.recorded).toBe(true);
    expect(isOk(second) && second.value.recorded).toBe(true);
    expect(store.estimate.props.depPaid).toBe(90_000);
    expect(ledger.rows).toHaveLength(2);
    expect(bus.recorded).toHaveLength(2); // one event per payment
  });

  it("a SMALLER second payment is still kept — order of arrival changes nothing", async () => {
    // Under the old `dep_paid_cents < amount` guard this exact case recorded NOTHING and reported
    // success: $600 landed first, then $300 was silently discarded.
    const { store, useCase } = setup();

    await useCase.exec(deposit(60_000, PI_A));
    const smaller = await useCase.exec(deposit(30_000, PI_B));

    expect(isOk(smaller) && smaller.value.recorded).toBe(true);
    expect(store.estimate.props.depPaid).toBe(90_000);
  });

  // ── refusals ─────────────────────────────────────────────────────────────────

  it("refuses a quote that is not accepted — a deposit on an unapproved quote is not a deposit", async () => {
    const { store, ledger, bus, useCase } = setup(
      acceptedEstimate({ status: "sent", acceptedAt: null }),
    );

    const result = await useCase.exec(deposit(30_000, PI_A));

    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.kind).toBe("conflict");
    expect(store.estimate.props.depPaid).toBe(0);
    expect(ledger.rows).toHaveLength(0);
    expect(bus.recorded).toHaveLength(0);
  });

  it("refuses when the estimate stops being acceptable BETWEEN the read and the write", async () => {
    // The ledger's INSERT … SELECT carries the status precondition, so the write refuses even
    // though the use-case's earlier read saw an accepted quote. Nothing may be recorded, and the
    // caller must learn about it — this is money with nowhere to land.
    const store = { estimate: acceptedEstimate() };
    const ledger = new FakeDepositLedger(store, () => {
      store.estimate = acceptedEstimate({ status: "declined", acceptedAt: null });
    });
    const bus = new InMemoryEventBus();
    const useCase = new RecordEstimateDepositUseCase(
      { findById: async () => acceptedEstimate() }, // the read still sees it accepted
      ledger,
      bus,
      clock,
    );

    const result = await useCase.exec(deposit(30_000, PI_A));

    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.kind).toBe("conflict");
    expect(ledger.rows).toHaveLength(0);
    expect(bus.recorded).toHaveLength(0);
  });

  it("refuses a missing estimate", async () => {
    const { useCase } = setup();
    const result = await useCase.exec({
      ...deposit(30_000, PI_A),
      estimateId: asEstimateId("99999999-9999-4999-8999-999999999999"),
    });
    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.kind).toBe("not_found");
  });

  it("refuses a zero or negative amount", async () => {
    const { useCase } = setup();
    for (const amountCents of [0, -1]) {
      expect(isOk(await useCase.exec(deposit(amountCents, PI_A)))).toBe(false);
    }
  });

  it("refuses money with no payment identity — it could not be deduplicated", async () => {
    const { ledger, useCase } = setup();
    for (const ref of ["", "   "]) {
      const result = await useCase.exec(deposit(30_000, ref));
      expect(isOk(result)).toBe(false);
      if (isOk(result)) return;
      expect(result.error.kind).toBe("validation");
    }
    expect(ledger.rows).toHaveLength(0);
  });

  it("scopes the load to the caller's org id", async () => {
    const { useCase } = setup();
    const result = await useCase.exec({
      ...deposit(30_000, PI_A),
      orgId: asOrgId("77777777-7777-4777-8777-777777777777"),
    });
    // The repo is tenant-scoped (RLS), so a foreign org sees nothing to record against.
    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.kind).toBe("not_found");
  });

  it("records a deposit larger than the derived ask (customer overpaid) without clamping", async () => {
    const { store, useCase } = setup(acceptedEstimate({ lines: [estimateLine(50_000)] }));
    // depositDue() is 30% of $500 = $150; the customer paid $200 at the door.
    const result = await useCase.exec(deposit(20_000, PI_A));
    expect(isOk(result) && result.value.recorded).toBe(true);
    expect(store.estimate.props.depPaid).toBe(20_000);
  });

  it("tops up an estimate that already carries a deposit from a prior ledger row", async () => {
    const { store, ledger, useCase } = setup(acceptedEstimate({ depPaid: money(10_000) }));
    ledger.rows.push({ paymentRef: "pi_earlier", amountCents: 10_000 });

    const result = await useCase.exec(deposit(20_000, PI_A));

    expect(isOk(result) && result.value.recorded).toBe(true);
    expect(store.estimate.props.depPaid).toBe(30_000); // 10_000 + 20_000, summed from the ledger
  });
});
