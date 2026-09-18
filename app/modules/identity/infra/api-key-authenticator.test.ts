import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { Database } from "@mallet/shared/db/client";
import { generateApiKey, hashApiKey, ApiKeyAuthenticator } from "./api-key-authenticator";

// A fake db whose execute() returns a fixed resolver result — lets us drive the row-handling
// branches (valid role → Principal; drifted role → fail closed) without a live DB.
const dbReturning = (rows: ReadonlyArray<{ id: string; org_id: string; role: string }>): Database =>
  ({ execute: async () => rows }) as unknown as Database;

describe("api key generation/hashing", () => {
  it("generates a prefixed raw key + a matching sha256 hex hash (raw never equals hash)", () => {
    const { raw, hash } = generateApiKey();
    expect(raw.startsWith("mallet_sk_")).toBe(true);
    expect(raw.length).toBeGreaterThan(24);
    expect(hash).toBe(hashApiKey(raw));
    expect(hash).toHaveLength(64); // sha256 hex
    expect(hash).not.toContain(raw);
  });

  it("hashes deterministically and uniquely per key", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(hashApiKey(a.raw)).toBe(a.hash);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("ApiKeyAuthenticator prefix guard", () => {
  it("rejects a non-mallet_sk_ token WITHOUT querying the DB", async () => {
    const db = {
      execute: () => {
        throw new Error("db must not be queried for a non-prefixed token");
      },
    } as unknown as Database;
    const auth = new ApiKeyAuthenticator(db);
    expect(await auth.authenticate("not-a-key")).toBeNull();
    expect(await auth.authenticate("")).toBeNull();
    expect(await auth.authenticate("sk-ant-something")).toBeNull();
  });
});

describe("ApiKeyAuthenticator row handling", () => {
  it("resolves a valid key row to a Principal (id → userId; org/role from the row, never input)", async () => {
    const id = randomUUID();
    const orgId = randomUUID();
    const auth = new ApiKeyAuthenticator(dbReturning([{ id, org_id: orgId, role: "office" }]));
    expect(await auth.authenticate("mallet_sk_deadbeef")).toEqual({ userId: id, orgId, role: "office" });
  });

  it("returns null (fail closed) for an unknown/revoked key — the resolver yields no row", async () => {
    const auth = new ApiKeyAuthenticator(dbReturning([]));
    expect(await auth.authenticate("mallet_sk_deadbeef")).toBeNull();
  });

  it("fails closed to null (NOT a throw) when a resolved row has an out-of-range role", async () => {
    const auth = new ApiKeyAuthenticator(dbReturning([{ id: randomUUID(), org_id: randomUUID(), role: "superuser" }]));
    expect(await auth.authenticate("mallet_sk_deadbeef")).toBeNull();
  });
});
