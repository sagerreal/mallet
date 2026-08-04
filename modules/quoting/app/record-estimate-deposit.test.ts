/**
 * RecordEstimateDepositUseCase — the ONLY path that moves `estimates.dep_paid_cents`.
 *
 * Task 4 deleted the fake stamping at accept, so a deposit is now zero until money actually
 * lands. This suite pins the three things that makes it trustworthy:
 *
 *   1. accept still leaves depPaid at 0 (the regression Task 4 fixed — asserted here at the
 *      deposit-recording seam so removing this file's premise breaks a test),
 *   2. only an ACCEPTED quote can take a deposit,
 *   3. the write is idempotent across the webhook AND the success-page reconcile, including the
 *      case where the second delivery lands BETWEEN the first one's read and its write.
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
  FakeDepositWriter,
} from "./quote-deposit.fixtures";

const NOW = new Date("2026-06-03T00:00:00Z");
const clock = new FixedClock(NOW);

const setup = (estimate = acceptedEstimate(), beforeWrite?: () => void) => {
  const store = { estimate };
  const writer = new FakeDepositWriter(store, beforeWrite);
  const bus = new InMemoryEventBus();
  const useCase = new RecordEstimateDepositUseCase(
    { findById: async (id) => (id === store.estimate.props.id ? store.estimate : null) },
    writer,
    bus,
    clock,
  );
  return { store, writer, bus, useCase };
};

describe("RecordEstimateDepositUseCase", () => {
  it("accepting a 30% quote leaves depPaid at 0 — the deposit is an ask, not a receipt", () => {
    const sent = acceptedEstimate({ status: "sent", acceptedAt: null });
    const accepted = sent.accept(NOW);
    expect(isOk(accepted)).toBe(true);
    if (!isOk(accepted)) return;
    expect(accepted.value.depositDue()).toBe(30_000); // 30% of $1,000
    expect(accepted.value.props.depPaid).toBe(0);
  });

  it("records the paid amount on the estimate and emits estimate.deposit.paid", async () => {
    const { store, bus, useCase } = setup();

    const result = await useCase.exec({ orgId: ORG, estimateId: EST, amountCents: 30_000 });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.recorded).toBe(true);
    expect(result.value.depositPaidCents).toBe(30_000);
    expect(store.estimate.props.depPaid).toBe(30_000);
    expect(bus.recorded).toEqual([
      {
        name: "estimate.deposit.paid",
        orgId: ORG,
        payload: {
          estimateId: EST,
          leadId: LEAD,
          amountCents: 30_000,
          depositDueCents: 30_000,
        },
        occurredAt: NOW,
      },
    ]);
  });

  it("refuses a quote that is not accepted — a deposit on an unapproved quote is not a deposit", async () => {
    const { store, bus, useCase } = setup(acceptedEstimate({ status: "sent", acceptedAt: null }));

    const result = await useCase.exec({ orgId: ORG, estimateId: EST, amountCents: 30_000 });

    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.kind).toBe("conflict");
    expect(store.estimate.props.depPaid).toBe(0);
    expect(bus.recorded).toHaveLength(0);
  });

  it("refuses a missing estimate", async () => {
    const { useCase } = setup();
    const result = await useCase.exec({
      orgId: ORG,
      estimateId: asEstimateId("99999999-9999-4999-8999-999999999999"),
      amountCents: 30_000,
    });
    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.kind).toBe("not_found");
  });

  it("refuses a zero or negative amount", async () => {
    const { useCase } = setup();
    for (const amountCents of [0, -1]) {
      const result = await useCase.exec({ orgId: ORG, estimateId: EST, amountCents });
      expect(isOk(result)).toBe(false);
    }
  });

  it("is idempotent: a second delivery of the same amount writes nothing and emits nothing", async () => {
    const { store, writer, bus, useCase } = setup();

    const first = await useCase.exec({ orgId: ORG, estimateId: EST, amountCents: 30_000 });
    const second = await useCase.exec({ orgId: ORG, estimateId: EST, amountCents: 30_000 });

    expect(isOk(first) && first.value.recorded).toBe(true);
    expect(isOk(second) && second.value.recorded).toBe(false);
    // Not an error: the money IS on the estimate — it just wasn't recorded twice.
    expect(isOk(second) && second.value.depositPaidCents).toBe(30_000);
    expect(store.estimate.props.depPaid).toBe(30_000); // not 60_000
    expect(writer.writes).toBe(1);
    expect(bus.recorded).toHaveLength(1);
  });

  it("loses the concurrent race safely: a delivery that lands mid-write no-ops, no double credit", async () => {
    // The webhook lands BETWEEN this call's read (depPaid 0 → proceed) and its conditional UPDATE.
    // The WHERE guard (dep_paid_cents < $amount) then matches zero rows, so this call must report
    // "already recorded" rather than overwrite or emit a second event.
    const store = { estimate: acceptedEstimate() };
    const writer = new FakeDepositWriter(store, () => {
      const raced = store.estimate.withDepositPaid(30_000, NOW);
      if (isOk(raced)) store.estimate = raced.value;
    });
    const bus = new InMemoryEventBus();
    const useCase = new RecordEstimateDepositUseCase(
      { findById: async () => store.estimate },
      writer,
      bus,
      clock,
    );

    const result = await useCase.exec({ orgId: ORG, estimateId: EST, amountCents: 30_000 });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.recorded).toBe(false);
    expect(result.value.depositPaidCents).toBe(30_000);
    expect(writer.writes).toBe(0); // the guarded UPDATE matched nothing
    expect(bus.recorded).toHaveLength(0); // only the winner emits
  });

  it("a LARGER later deposit still records — the guard is 'less than', not 'zero'", async () => {
    const { store, useCase } = setup(acceptedEstimate({ depPaid: money(10_000) }));

    const result = await useCase.exec({ orgId: ORG, estimateId: EST, amountCents: 30_000 });

    expect(isOk(result) && result.value.recorded).toBe(true);
    expect(store.estimate.props.depPaid).toBe(30_000);
  });

  it("scopes the load to the caller's org id", async () => {
    const { useCase } = setup();
    const result = await useCase.exec({
      orgId: asOrgId("77777777-7777-4777-8777-777777777777"),
      estimateId: EST,
      amountCents: 30_000,
    });
    // The repo is tenant-scoped (RLS), so a foreign org sees nothing to record against.
    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.kind).toBe("not_found");
  });

  it("records a deposit larger than the derived ask (customer overpaid) without clamping", async () => {
    const { store, useCase } = setup(acceptedEstimate({ lines: [estimateLine(50_000)] }));
    // depositDue() is 30% of $500 = $150; the customer paid $200 at the door.
    const result = await useCase.exec({ orgId: ORG, estimateId: EST, amountCents: 20_000 });
    expect(isOk(result) && result.value.recorded).toBe(true);
    expect(store.estimate.props.depPaid).toBe(20_000);
  });
});
