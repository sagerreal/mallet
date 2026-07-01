import { describe, it, expect } from "vitest";
import type { Database } from "@mallet/shared/db/client";
import { generateApiKey, hashApiKey, ApiKeyAuthenticator } from "./api-key-authenticator";

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
