/**
 * scripts/e2e-credentials.mjs
 * The fixture logins for the plain-node verification scripts — the ESM twin of
 * `e2e/credentials.ts`, which the Playwright specs import.
 *
 * Two files rather than one only because these scripts run as bare `.mjs` under node with no
 * TypeScript loader; the VALUES and the env overrides are identical, and both carry the same
 * default so they cannot disagree. If you change one, change the other — a test asserts they match
 * (`e2e/credentials.test.ts`), so a drift fails the suite rather than a login page.
 */

export const OWNER = {
  email: process.env.E2E_OWNER_EMAIL ?? "owner@e2e.mallet.test",
  password: process.env.E2E_OWNER_PASSWORD ?? "e2e-password-1",
};

export const TECH = {
  email: process.env.E2E_TECH_EMAIL ?? "tech@e2e.mallet.test",
  password: process.env.E2E_TECH_PASSWORD ?? process.env.E2E_OWNER_PASSWORD ?? "e2e-password-1",
};
