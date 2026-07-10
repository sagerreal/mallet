import { describe, it, expect } from "vitest";
import { confirmDestination } from "./confirm-destination";

describe("confirmDestination", () => {
  // Type-default routing
  it('routes recovery to /reset-password when next is absent', () => {
    expect(confirmDestination("recovery", undefined)).toBe("/reset-password");
  });

  it('routes invite to /auth/set-password when next is absent', () => {
    expect(confirmDestination("invite", undefined)).toBe("/auth/set-password");
  });

  it('routes magiclink to / when next is absent', () => {
    expect(confirmDestination("magiclink", undefined)).toBe("/");
  });

  it('routes signup to / when next is absent', () => {
    expect(confirmDestination("signup", undefined)).toBe("/");
  });

  it('routes email (email change) to / when next is absent', () => {
    expect(confirmDestination("email", undefined)).toBe("/");
  });

  // Safe next wins
  it('uses a safe next for invite', () => {
    expect(confirmDestination("invite", "/x")).toBe("/x");
  });

  it('uses a safe next for recovery', () => {
    expect(confirmDestination("recovery", "/new-password")).toBe("/new-password");
  });

  // Unsafe next falls back to type default (open-redirect guard via safeNext)
  it('rejects protocol-relative URL for invite, falls back to type default', () => {
    expect(confirmDestination("invite", "//evil.com")).toBe("/auth/set-password");
  });

  it('rejects absolute https URL for recovery, falls back to type default', () => {
    expect(confirmDestination("recovery", "https://evil")).toBe("/reset-password");
  });

  it('rejects absolute https URL for magiclink, falls back to /', () => {
    expect(confirmDestination("magiclink", "https://evil.com")).toBe("/");
  });

  it('rejects paths not starting with / for invite', () => {
    expect(confirmDestination("invite", "evil.com/path")).toBe("/auth/set-password");
  });

  it('returns type default when next is null', () => {
    expect(confirmDestination("invite", null)).toBe("/auth/set-password");
    expect(confirmDestination("recovery", null)).toBe("/reset-password");
  });
});
