import { describe, it, expect } from "vitest";
import { emailSubjectFor } from "./email-subject";

describe("emailSubjectFor", () => {
  it("returns the invoice_sent subject", () => {
    expect(emailSubjectFor("invoice_sent")).toBe("Your invoice is ready");
  });

  it("returns the invoice_reminder subject", () => {
    expect(emailSubjectFor("invoice_reminder")).toBe("Reminder: your invoice is due");
  });

  it("returns the estimate_sent subject", () => {
    expect(emailSubjectFor("estimate_sent")).toBe("Your estimate is ready");
  });

  it("returns the estimate_reminder subject", () => {
    expect(emailSubjectFor("estimate_reminder")).toBe("Reminder: your estimate is waiting");
  });

  it("returns the neutral fallback for an unknown kind", () => {
    expect(emailSubjectFor("completely_unknown_kind")).toBe(
      "A message from your service provider"
    );
  });

  it("returns the neutral fallback for an empty string", () => {
    expect(emailSubjectFor("")).toBe("A message from your service provider");
  });
});
