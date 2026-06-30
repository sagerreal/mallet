import { defineConfig } from "vitest/config";
import { malletAliases } from "./vitest.aliases";

// Unit suite — hermetic, secret-free, CI-safe. Integration tests (*.int.test.ts) hit a live DB
// and run under vitest.integration.config.ts instead, so they're excluded here.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**", "**/*.int.test.ts"],
  },
  resolve: {
    alias: malletAliases(import.meta.dirname),
  },
});
