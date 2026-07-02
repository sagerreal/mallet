import { defineConfig } from "@playwright/test";

// Point at a deployed URL with E2E_BASE_URL to smoke-test a real environment;
// otherwise boot the local dev server as usual.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  use: { baseURL },
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: "pnpm dev",
          url: "http://localhost:3000",
          reuseExistingServer: true,
          timeout: 60_000,
        },
      }),
});
