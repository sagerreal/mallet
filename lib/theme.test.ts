/**
 * The theme file is a CLEAN-UP now — dark mode was cut (Aug 2026) and the script's whole job is
 * unsticking anyone the old toggle left stamped dark. These pin the two facts that matter.
 */
import { describe, it, expect } from "vitest";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "./theme";

describe("the theme clean-up script", () => {
  it("removes the stamp and the stored choice — nobody stays locked in dark", () => {
    expect(THEME_INIT_SCRIPT).toContain("removeAttribute('data-theme')");
    expect(THEME_INIT_SCRIPT).toContain(`removeItem('${THEME_STORAGE_KEY}')`);
  });

  it("never sets a theme — the app is light, and dark is not reachable from here", () => {
    expect(THEME_INIT_SCRIPT).not.toContain("setAttribute");
    expect(THEME_INIT_SCRIPT).not.toContain("setItem");
  });
});
