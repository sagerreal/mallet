import { describe, it, expect } from "vitest";
import { validation, notFound, conflict, externalService, unauthorized } from "@mallet/shared/types";
import { safeLastError } from "./last-error";

describe("safeLastError", () => {
  it("maps each AppError kind to its bare kind string", () => {
    expect(safeLastError({ kind: "apperror", error: validation("bad", "field") })).toBe("validation");
    expect(safeLastError({ kind: "apperror", error: notFound("invoice") })).toBe("not_found");
    expect(safeLastError({ kind: "apperror", error: conflict("nope") })).toBe("conflict");
    expect(safeLastError({ kind: "apperror", error: unauthorized() })).toBe("unauthorized");
  });

  it("includes the service (not the message) for external_service", () => {
    expect(safeLastError({ kind: "apperror", error: externalService("twilio", "boom", true) })).toBe("external_service:twilio");
  });

  it("maps a thrown value to 'unhandled'", () => {
    expect(safeLastError({ kind: "threw" })).toBe("unhandled");
  });

  it("never leaks PII carried in a provider error message", () => {
    const out = safeLastError({
      kind: "apperror",
      error: externalService("twilio", "The 'To' number +15555550123 is invalid; body: your invoice", true),
    });
    expect(out).toBe("external_service:twilio");
    expect(out).not.toContain("+15555550123");
    expect(out).not.toContain("invoice");
  });
});
