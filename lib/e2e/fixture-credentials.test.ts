import { describe, it, expect } from "vitest";
import { readFileSync, globSync } from "node:fs";

/**
 * Lives under lib/ rather than e2e/ because eslint parses lib/ as TypeScript and does not parse
 * e2e/ — a test that cannot be linted is a test nobody notices rotting.
 *
 * The two fixture-credential definitions must agree.
 *
 * `e2e/helpers/ui.ts` serves the Playwright specs; `scripts/e2e-credentials.mjs` serves the
 * plain-node verification scripts, which run without a TypeScript loader and so cannot import the
 * first. Two files is a deliberate concession to that, and two files is exactly how a default
 * drifts — one gets rotated, the other does not, and the halves of the harness sign in as
 * different users until somebody reads a login page carefully.
 *
 * So the defaults are compared as TEXT rather than by importing both: the point is that the
 * literals in the source match, not that two modules happen to agree at runtime under whatever
 * environment this test inherits.
 */

const defaultsIn = (path: string): { owner: string; tech: string } => {
  const src = readFileSync(path, "utf8");
  // The fallback in `process.env.X ?? "…"`, per account block.
  const owner = /email:[^]*?owner@e2e\.mallet\.test[^]*?password:[^]*?\?\?\s*"([^"]+)"/.exec(src);
  const tech = /email:[^]*?tech@e2e\.mallet\.test[^]*?password:[^]*?\?\?\s*"([^"]+)"/.exec(src);
  if (!owner || !tech) throw new Error(`could not read fixture defaults from ${path}`);
  return { owner: owner[1]!, tech: tech[1]! };
};

describe("E2E fixture credentials", () => {
  it("the Playwright helper and the scripts helper carry the same defaults", () => {
    const ui = defaultsIn("e2e/helpers/ui.ts");
    const scripts = defaultsIn("scripts/e2e-credentials.mjs");
    expect(scripts).toEqual(ui);
  });

  /**
   * The literal must be the password that is actually live in the shared project. This cannot be
   * asserted here without a network call, so what IS asserted is that nobody has quietly typed a
   * different one into either file — the guard that would have caught three wasted resets in a
   * single day, each of which broke 42 scripts to "fix" one login.
   */
  it("no script types the password by hand any more", () => {
    const files = globSync("scripts/*.mjs").filter((f: string) => !f.endsWith("e2e-credentials.mjs"));
    const offenders = files.filter((f) => readFileSync(f, "utf8").includes("e2e-password"));
    expect(offenders).toEqual([]);
  });
});
