import { defineConfig } from "vitest/config";
import { malletAliases } from "./vitest.aliases";

/**
 * Config for the SEED scripts in scripts/*.seed.ts.
 *
 * They exist separately because they write to a real org, and the integration config deliberately
 * excludes scripts/** so `npm run test:int` can never trigger one — an earlier version of these
 * files was named *.int.test.ts and would have re-seeded ~1,500 jobs into production on every
 * integration run.
 *
 * That guard left the seeds unrunnable, which is the right trade only if there is a deliberate way
 * back in. This is it:
 *
 *   npx vitest run --config vitest.seed.config.ts scripts/<name>
 *
 * Never wire this into a CI step or an npm script that runs as part of a gate.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/**/*.seed.ts"],
    setupFiles: ["./vitest.int.setup.ts"],
    testTimeout: 600_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
  resolve: { alias: malletAliases(import.meta.dirname) },
});
