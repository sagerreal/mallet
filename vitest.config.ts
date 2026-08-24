import { defineConfig } from "vitest/config";
import { malletAliases } from "./vitest.aliases";

// Unit suite — hermetic, secret-free, CI-safe. Integration tests (*.int.test.ts) hit a live DB
// and run under vitest.integration.config.ts instead, so they're excluded here.
//
// Coverage scope: shared/, modules/, platform/ only — NOT app/api/** (Next.js route handlers).
// app/api/** wires tRPC and Next.js plumbing; its behavioural coverage lives in pnpm test:int.
export default defineConfig({
  test: {
    environment: "node",
    // .test.mjs is here for scripts/ — build tooling that runs under plain node (the Vercel
    // buildCommand) and so cannot be TypeScript. tsconfig has allowJs:false, so those files are
    // invisible to tsc; this is what gives them a test.
    include: ["**/*.test.ts", "**/*.test.tsx", "**/*.test.mjs"],
    exclude: ["node_modules/**", "**/node_modules/**", ".next/**", ".claude/**", "**/*.int.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      // Measure the pure-logic layers unit tests own. Infra/api/wiring talk to a live DB and are
      // covered by `pnpm test:int` (needs secrets), so they're excluded from this threshold.
      include: ["shared/**/*.ts", "modules/**/*.ts", "platform/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.int.test.ts",
        "**/index.ts",
        "shared/db/migrations/**",
        "shared/db/schema/**",
        "shared/db/client.ts",
        "shared/db/owner-client.ts",
        "shared/db/tx.ts",
        // DB-orchestration infra covered by pnpm test:int (like the repos). The relay's PURE logic
        // (disposition.ts, last-error.ts) stays counted and is unit-tested.
        "shared/outbox/relay/relay.ts",
        // The agent runner is the same shape: pure I/O orchestration whose only judgement is
        // decideWake, which the unit suite owns at 100%. Proven by agent-task-runner.int.test.ts.
        // (Also matched by modules/**/infra/** below; named here so the reason is on the record.)
        "modules/agent-tasks/infra/agent-task-runner.ts",
        "modules/invoicing/app/invoice-paid-audit-handler.ts",
        "modules/**/infra/**",
        "modules/**/api/**",
      ],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 75 },
    },
  },
  resolve: {
    alias: malletAliases(import.meta.dirname),
  },
});
