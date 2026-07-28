/**
 * lib/theme.test.ts
 *
 * Dark mode was opt-in only: `html{color-scheme:light}` plus a toggle that wrote
 * localStorage. A phone set to dark got a bright cream app — at 6am, on a job site,
 * in a van. Apple's HIG expects the system setting to be honoured.
 *
 * Two rules, and the ORDER of them is the whole design:
 *   an explicit choice always beats the system, and the system is the default.
 * A user who has deliberately picked light must not be flipped to dark at sunset.
 */
import { describe, it, expect } from "vitest";
import { resolveInitialTheme, nextTheme } from "./theme";

describe("resolveInitialTheme", () => {
  it("follows the system when the user has never chosen", () => {
    expect(resolveInitialTheme(null, true)).toBe("dark");
    expect(resolveInitialTheme(null, false)).toBe("light");
  });

  it("honours an explicit choice over the system, in both directions", () => {
    expect(resolveInitialTheme("light", true)).toBe("light");
    expect(resolveInitialTheme("dark", false)).toBe("dark");
  });

  it("ignores a corrupted stored value and falls back to the system", () => {
    // localStorage is user-writable and survives deploys; a stale or hand-edited
    // value must not wedge the app into an undefined theme.
    expect(resolveInitialTheme("blue", true)).toBe("dark");
    expect(resolveInitialTheme("", false)).toBe("light");
    expect(resolveInitialTheme("DARK", false)).toBe("light");
  });
});

describe("nextTheme", () => {
  it("toggles from whatever is currently EFFECTIVE, not from a hardcoded default", () => {
    // The old toggle initialised its state to "light" regardless of what was on
    // screen, so on a system-dark phone the first tap was a no-op that appeared
    // to do nothing.
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
  });
});
