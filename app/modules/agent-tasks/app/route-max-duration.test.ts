import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { TICK_MAX_DURATION_SECONDS, TRPC_MAX_DURATION_SECONDS } from "./agent-task-config";

/**
 * THE ASSERTION THAT ACTUALLY GATES IN CI, and the reason it is written this ugly way.
 *
 * The lease arithmetic in agent-task-config.ts is derived from the `maxDuration` its route exports:
 * `LEASE_MINUTES` and `TICK_BUDGET_MS` both come off `TICK_MAX_DURATION_SECONDS`, and `REPLY_LEASE_MS`
 * off `TRPC_MAX_DURATION_SECONDS`. If a route's literal is raised (a bigger Vercel plan permits 600s)
 * without moving the constant, the derivation is silently wrong and the DUPLICATE-CUSTOMER-MESSAGE
 * defect ADR 0008 §3a describes REOPENS with no test failing anywhere: a lease that expires while a
 * wake is genuinely mid-turn lets the next tick reclaim the row, two concurrent wakes mint two
 * different `tool_use` ids, and nothing dedupes those — the customer gets a second text.
 *
 * WHY NOT `import { maxDuration } from "…/route"`. It cannot be done from the unit suite: the route
 * imports `@/trpc/di` -> `shared/db/client.ts`, which calls `loadConfig()` at MODULE scope and throws
 * with no database env. That assertion therefore lived in `route.int.test.ts` — which CI never runs,
 * and which `describe.skip`s itself without three env vars. The invariant was enforced NOWHERE.
 *
 * Reading the file as text has no import graph, so it runs in CI with no secrets. It is coupled to
 * the literal's SHAPE, which is a deliberate trade: Next.js requires `maxDuration` to be a
 * statically analyzable literal anyway, so the shape cannot drift without the platform noticing too.
 */
const literalMaxDuration = (routePath: string): number => {
  const source = readFileSync(new URL(routePath, import.meta.url), "utf-8");
  const match = /^export const maxDuration = (\d+);$/m.exec(source);
  // A missing export is a FAILURE, not a skip: no `maxDuration` means the platform default, which
  // is far below what these constants assume.
  expect(match, `no \`export const maxDuration = <n>;\` found in ${routePath}`).not.toBeNull();
  return Number(match![1]);
};

describe("route maxDuration matches the constants derived from it", () => {
  it("the agent runner's route exports exactly TICK_MAX_DURATION_SECONDS", () => {
    expect(literalMaxDuration("../../../app/api/cron/agent-runner/route.ts")).toBe(TICK_MAX_DURATION_SECONDS);
  });

  it("the tRPC route (which every reply arrives on) exports exactly TRPC_MAX_DURATION_SECONDS", () => {
    // REPLY_LEASE_MS is sized to outlive this: a reply killed at the ceiling must still be fenced
    // for the whole time it was really running, or the runner reclaims the row mid-turn.
    expect(literalMaxDuration("../../../app/api/trpc/[trpc]/route.ts")).toBe(TRPC_MAX_DURATION_SECONDS);
  });
});
