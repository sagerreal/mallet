/**
 * modules/identity/domain/role-change.test.ts
 *
 * Settings printed the transport's message verbatim, so demoting the only owner answered with
 * "cannot remove the last owner" — lowercase, no full stop, and no way forward. These tests pin
 * the two halves of the fix together: the sentence itself, and the CODE it has to travel under for
 * that sentence to survive the client's error map at all.
 */
import { describe, it, expect } from "vitest";
import { userMessage } from "@/lib/trpc/error-map";
import { LAST_OWNER_REFUSAL } from "./role-change";

describe("the last-owner refusal", () => {
  it("is a sentence with a next step, not a log fragment", () => {
    expect(LAST_OWNER_REFUSAL).toMatch(/^[A-Z]/);
    expect(LAST_OWNER_REFUSAL).toMatch(/\.$/);
    // The refusal is useless without the move that clears it.
    expect(LAST_OWNER_REFUSAL).toMatch(/make someone else an owner/i);
  });

  it("reaches the user under CONFLICT — the code the client passes through", () => {
    const refusal = { data: { code: "CONFLICT" }, message: LAST_OWNER_REFUSAL };

    expect(userMessage(refusal)).toBe(LAST_OWNER_REFUSAL);
  });

  it("would have been swallowed as a FORBIDDEN", () => {
    // Why the code moved rather than only the wording: FORBIDDEN maps to fixed copy about the
    // caller's ROLE, which is wrong here — an owner IS allowed to change roles. The org is what
    // cannot be left without an owner.
    const asForbidden = { data: { code: "FORBIDDEN" }, message: LAST_OWNER_REFUSAL };

    expect(userMessage(asForbidden)).not.toBe(LAST_OWNER_REFUSAL);
  });
});
