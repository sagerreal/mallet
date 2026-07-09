import { describe, it, expect } from "vitest";
import { composeInvoiceReminder, composeInvoiceSent } from "./invoice-reminder";
import type { ReminderTarget } from "../domain/reminder-target-reader";

const makeTarget = (overrides: Partial<ReminderTarget> = {}): ReminderTarget => ({
  type: "invoice",
  id: "inv-1",
  num: "INV-001",
  status: "sent",
  sentAt: new Date("2026-07-01T00:00:00Z"),
  phone: "+15555550100",
  email: "customer@example.com",
  balanceCents: 15000,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

describe("composeInvoiceReminder", () => {
  it("returns a polite first-touch message for stage 1", () => {
    const target = makeTarget({ num: "INV-042", balanceCents: 25000 });
    const result = composeInvoiceReminder(target, 1);
    expect(result).toBe("Invoice INV-042: balance $250.00 is due. Reply or call to pay. Thank you.");
  });

  it("returns a polite first-touch message for stage 0 (boundary: stage <= 1)", () => {
    const target = makeTarget({ num: "INV-007", balanceCents: 5000 });
    const result = composeInvoiceReminder(target, 0);
    expect(result).toBe("Invoice INV-007: balance $50.00 is due. Reply or call to pay. Thank you.");
  });

  it("returns a firmer past-due message for stage 2", () => {
    const target = makeTarget({ num: "INV-099", balanceCents: 99900 });
    const result = composeInvoiceReminder(target, 2);
    expect(result).toBe(
      "Reminder: invoice INV-099 balance $999.00 is past due. Please pay at your earliest convenience."
    );
  });

  it("returns a firmer past-due message for stage 3 (any stage > 1)", () => {
    const target = makeTarget({ num: "INV-003", balanceCents: 100 });
    const result = composeInvoiceReminder(target, 3);
    expect(result).toBe(
      "Reminder: invoice INV-003 balance $1.00 is past due. Please pay at your earliest convenience."
    );
  });

  it("formats cents to dollars correctly in the stage > 1 branch", () => {
    const target = makeTarget({ num: "INV-010", balanceCents: 12345 });
    const result = composeInvoiceReminder(target, 2);
    expect(result).toContain("$123.45");
  });
});

describe("composeInvoiceSent", () => {
  it("returns a ready-to-pay message with the invoice number and amount", () => {
    const target = makeTarget({ num: "INV-021", balanceCents: 8000 });
    const result = composeInvoiceSent(target);
    expect(result).toBe(
      "Invoice INV-021 for $80.00 is ready. Reply or call to pay. Thank you."
    );
  });

  it("formats a zero-cent balance as $0.00", () => {
    const target = makeTarget({ num: "INV-000", balanceCents: 0 });
    const result = composeInvoiceSent(target);
    expect(result).toBe(
      "Invoice INV-000 for $0.00 is ready. Reply or call to pay. Thank you."
    );
  });

  it("includes the invoice number in the sent message", () => {
    const target = makeTarget({ num: "INV-XYZ", balanceCents: 50000 });
    const result = composeInvoiceSent(target);
    expect(result).toContain("INV-XYZ");
  });
});
