import { describe, it, expect, afterAll } from "vitest";
import { closeOwnerDb } from "@mallet/shared/db/owner-client";
import { closeDb } from "@mallet/shared/db/client";
import { GET } from "./route";

// Gated the same way as the outbox route's int test: an absent env silently skips (0 assertions,
// exit 0) rather than failing, so a CI run without .env.local reports nothing tested, not a pass.
const hasEnv = Boolean(process.env.CRON_SECRET && process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasEnv ? describe : describe.skip;
const URL = "https://mallet.test/api/cron/agent-runner";

suite("agent-runner cron route", () => {
  const call = (headers: Record<string, string> = {}) => GET(new Request(URL, { method: "GET", headers }));

  afterAll(async () => {
    await closeOwnerDb();
    await closeDb();
  });

  it("401s with no credential, and does not echo the secret", async () => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain(process.env.CRON_SECRET as string);
  });

  it("401s on a wrong credential", async () => {
    const res = await call({ authorization: "Bearer definitely-not-the-secret" });
    expect(res.status).toBe(401);
  });

  it("503s when the secret is unset rather than running unauthenticated", async () => {
    const saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const res = await call();
      expect(res.status).toBe(503);
    } finally {
      process.env.CRON_SECRET = saved;
    }
  });

  it("runs a bounded tick for a valid credential", async () => {
    const res = await call({ authorization: `Bearer ${process.env.CRON_SECRET}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { claimed: number; tookMs: number };
    expect(typeof body.claimed).toBe("number");
    expect(typeof body.tookMs).toBe("number");
  });
});
