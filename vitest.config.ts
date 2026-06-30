import { defineConfig } from "vitest/config";
import { malletAliases } from "./vitest.aliases";

// Unit suite — hermetic, secret-free, CI-safe. Integration tests (*.int.test.ts) hit a live DB
// and run under vitest.integration.config.ts instead, so they're excluded here.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**", "**/*.int.test.ts"],
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
        "shared/db/tx.ts",
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
