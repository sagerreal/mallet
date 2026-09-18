import { describe, it, expect } from "vitest";
import { asLeadId } from "@mallet/shared/types";
import { PaymentProfile, CARD_ON_FILE_SOURCES } from "./payment-profile";

const base = {
  id: "3f1f9d68-0000-4000-8000-000000000001",
  leadId: asLeadId("3f1f9d68-0000-4000-8000-000000000002"),
  stripeCustomerId: "cus_ABC123",
  stripePaymentMethodId: "pm_ABC123",
  brand: "visa",
  last4: "4242",
  via: "payment" as const,
  savedAt: new Date("2026-08-12T10:00:00Z"),
};

describe("PaymentProfile.create", () => {
  it("creates a profile from Stripe's own facts", () => {
    const r = PaymentProfile.create(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.props.brand).toBe("visa");
    expect(r.value.props.last4).toBe("4242");
  });

  it("refuses a last4 that is not exactly four digits — the one presentational fact surfaces trust", () => {
    for (const last4 of ["424", "42424", "abcd", "", "4242 "]) {
      const r = PaymentProfile.create({ ...base, last4 });
      expect(r.ok).toBe(false);
    }
  });

  it("refuses empty Stripe pointers — a profile that cannot charge is not a profile", () => {
    expect(PaymentProfile.create({ ...base, stripeCustomerId: "  " }).ok).toBe(false);
    expect(PaymentProfile.create({ ...base, stripePaymentMethodId: "" }).ok).toBe(false);
  });

  it("refuses an empty brand and an unknown via", () => {
    expect(PaymentProfile.create({ ...base, brand: " " }).ok).toBe(false);
    expect(PaymentProfile.create({ ...base, via: "terminal" as never }).ok).toBe(false);
  });

  it("summary() exposes ONLY the presentational facts — never the Stripe pointers", () => {
    const r = PaymentProfile.create(base);
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.summary()).toEqual({ brand: "visa", last4: "4242", via: "payment" });
  });

  it("names both capture sources and no more", () => {
    expect(CARD_ON_FILE_SOURCES).toEqual(["payment", "deposit"]);
  });
});
