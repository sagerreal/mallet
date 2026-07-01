import { describe, it, expect, afterAll } from "vitest";
import { closeDb } from "@mallet/shared/db/client";
import { closeOwnerDb } from "@mallet/shared/db/owner-client";
import { GET } from "./route";

// The cron route's auth gate + summary shape. Gated on the same env the relay needs so the 200 path
// can actually run a (harmless, idempotent) relay tick.
const hasEnv = Boolean(process.env.CRON_SECRET && process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasEnv ? describe : describe.skip;

const URL = "http://localhost/api/cron/outbox";
const call = (headers: Record<string, string> = {}) => GET(new Request(URL, { method: "GET", headers }));

suite("outbox cron route auth", () => {
  afterAll(async () => {
    await closeOwnerDb();
    await closeDb();
  });

  it("rejects a request with no credential (401), leaking nothing", async () => {
    const res = await call();
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).not.toContain(process.env.CRON_SECRET as string);
  });

  it("rejects a wrong secret (401)", async () => {
    const res = await call({ authorization: "Bearer definitely-not-the-secret-value" });
    expect(res.status).toBe(401);
  });

  it("503s when CRON_SECRET is unconfigured (fail-closed, never runs unauthenticated)", async () => {
    const saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const res = await call({ authorization: `Bearer ${saved}` });
      expect(res.status).toBe(503);
    } finally {
      process.env.CRON_SECRET = saved;
    }
  });

  it("runs a relay tick and returns the summary for a valid secret (200)", async () => {
    const res = await call({ authorization: `Bearer ${process.env.CRON_SECRET}` });
    expect(res.status).toBe(200);
    const summary = (await res.json()) as Record<string, number>;
    for (const key of ["claimed", "published", "drainedNoOp", "failed", "poisoned", "tookMs"]) {
      expect(typeof summary[key]).toBe("number");
    }
  });
});
