import { describe, it, expect } from "vitest";
import { money, isOk } from "@mallet/shared/types";
import { Payment, type PaymentProps, PAYMENT_METHODS, isPaymentMethod } from "./payment";

const props = (overrides: Partial<PaymentProps> = {}): PaymentProps => ({
  id: "pay-1",
  amount: money(5000),
  method: "cash",
  idempotencyKey: "idem-key-123",
  externalId: null,
  receivedAt: new Date("2026-06-01T00:00:00Z"),
  ...overrides,
});

const make = (overrides: Partial<PaymentProps> = {}): Payment => {
  const r = Payment.create(props(overrides));
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

describe("Payment.create – happy path", () => {
  it("succeeds with valid props and exposes them via .props", () => {
    const p = make();
    expect(p.props.id).toBe("pay-1");
    expect(p.props.amount).toBe(money(5000));
    expect(p.props.method).toBe("cash");
    expect(p.props.idempotencyKey).toBe("idem-key-123");
    expect(p.props.externalId).toBeNull();
  });

  it("accepts every known payment method", () => {
    for (const method of PAYMENT_METHODS) {
      const r = Payment.create(props({ method }));
      expect(r.ok).toBe(true);
    }
  });

  it("accepts an idempotency key of exactly 8 characters", () => {
    const r = Payment.create(props({ idempotencyKey: "12345678" }));
    expect(r.ok).toBe(true);
  });

  it("accepts a non-null externalId", () => {
    const p = make({ externalId: "pi_stripe123" });
    expect(p.props.externalId).toBe("pi_stripe123");
  });
});

describe("Payment.create – validation rejections", () => {
  it("rejects amount of zero", () => {
    const r = Payment.create(props({ amount: money(0) }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.field).toBe("amount");
      expect(r.error.message).toMatch(/positive/);
    }
  });

  it("rejects amount below zero (negative cents)", () => {
    const r = Payment.create(props({ amount: money(-1) }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.field).toBe("amount");
      expect(r.error.message).toMatch(/positive/);
    }
  });

  it("rejects an unknown payment method", () => {
    const r = Payment.create(props({ method: "bitcoin" as never }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.field).toBe("method");
      expect(r.error.message).toMatch(/unknown payment method/);
    }
  });

  it("rejects an empty string as payment method", () => {
    const r = Payment.create(props({ method: "" as never }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("method");
  });

  it("rejects an idempotency key shorter than 8 chars", () => {
    const r = Payment.create(props({ idempotencyKey: "short" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.field).toBe("idempotencyKey");
      expect(r.error.message).toMatch(/8 chars/);
    }
  });

  it("rejects an idempotency key of exactly 7 characters", () => {
    const r = Payment.create(props({ idempotencyKey: "1234567" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("idempotencyKey");
  });

  it("rejects an idempotency key that is only whitespace (trimmed to <8 chars)", () => {
    // 7 spaces trims to 0 chars — below the minimum
    const r = Payment.create(props({ idempotencyKey: "       " }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("idempotencyKey");
  });
});

describe("isPaymentMethod", () => {
  it("returns true for every member of PAYMENT_METHODS", () => {
    for (const m of PAYMENT_METHODS) {
      expect(isPaymentMethod(m)).toBe(true);
    }
  });

  it("returns false for an arbitrary unknown string", () => {
    expect(isPaymentMethod("venmo")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isPaymentMethod("")).toBe(false);
  });
});
