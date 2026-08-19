import { describe, it, expect } from "vitest";
import { isStaleDeployError } from "./stale-deploy-error";

/**
 * The stale-deploy predicate — the signatures Webpack/Turbopack and the three browser engines
 * actually produce when a tab from an old build asks for a chunk the new deploy replaced.
 */
describe("isStaleDeployError", () => {
  it("matches ChunkLoadError by name", () => {
    const e = new Error("Loading chunk 4821 failed.");
    e.name = "ChunkLoadError";
    expect(isStaleDeployError(e)).toBe(true);
  });

  it("matches the engines' dynamic-import failures by message", () => {
    for (const msg of [
      "Loading chunk app/(office)/customers/page failed. (error: https://app.trymallet.com/_next/...)",
      "Failed to fetch dynamically imported module: https://app.trymallet.com/_next/static/chunks/x.js",
      "error loading dynamically imported module",
      "Importing a module script failed.",
    ]) {
      expect(isStaleDeployError(new Error(msg))).toBe(true);
    }
  });

  it("rejects ordinary crashes and non-errors", () => {
    expect(isStaleDeployError(new Error("Cannot read properties of undefined (reading 'stages')"))).toBe(false);
    expect(isStaleDeployError("Loading chunk 1 failed")).toBe(false);
    expect(isStaleDeployError(null)).toBe(false);
  });
});
