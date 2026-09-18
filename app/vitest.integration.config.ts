import { defineConfig } from "vitest/config";
import { malletAliases } from "./vitest.aliases";

// Integration suite: ONLY *.int.test.ts, against a live database. Loads .env.local first, runs
// serially (shared DB), and allows longer timeouts for network round-trips.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.int.test.ts"],
    // scripts/** is excluded deliberately. The seed scripts there write to a REAL org, and while
    // they now carry a .seed.ts suffix that this glob cannot match, the suffix is one careless
    // rename away from being .int.test.ts again — at which point every `npm run test:int` would
    // silently add another 1,500 jobs to production. Two independent guards, on purpose.
    exclude: ["node_modules/**", "**/node_modules/**", ".next/**", ".claude/**", "scripts/**"],
    setupFiles: ["./vitest.int.setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
  resolve: {
    alias: malletAliases(import.meta.dirname),
  },
});
