import { defineConfig } from "vitest/config";
import { malletAliases } from "./vitest.aliases";

// Integration suite: ONLY *.int.test.ts, against a live database. Loads .env.local first, runs
// serially (shared DB), and allows longer timeouts for network round-trips.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.int.test.ts"],
    exclude: ["node_modules/**", "**/node_modules/**", ".next/**", ".claude/**"],
    setupFiles: ["./vitest.int.setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
  resolve: {
    alias: malletAliases(import.meta.dirname),
  },
});
