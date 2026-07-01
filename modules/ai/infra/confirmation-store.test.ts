import { describe, it, expect } from "vitest";
import { generateConfirmToken, hashConfirmToken, CONFIRMATION_TTL_MS, MAX_PENDING_PROPOSALS } from "./confirmation-store";

describe("confirmation token generation/hashing", () => {
  it("generates a prefixed raw token + a matching sha256 hex hash (raw never equals hash)", () => {
    const { raw, hash } = generateConfirmToken();
    expect(raw.startsWith("mallet_confirm_")).toBe(true);
    expect(raw.length).toBeGreaterThan(24);
    expect(hash).toBe(hashConfirmToken(raw));
    expect(hash).toHaveLength(64); // sha256 hex
    expect(hash).not.toContain(raw);
  });

  it("hashes deterministically and uniquely per token", () => {
    const a = generateConfirmToken();
    const b = generateConfirmToken();
    expect(hashConfirmToken(a.raw)).toBe(a.hash);
    expect(a.hash).not.toBe(b.hash);
  });

  it("keeps the leak-bounding constants tight: short TTL, capped pending proposals", () => {
    // The raw token travels in-band (transcripts/host logs) — the window must stay minutes-short.
    expect(CONFIRMATION_TTL_MS).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(MAX_PENDING_PROPOSALS).toBeLessThanOrEqual(50);
  });
});
