/**
 * lib/theme.ts
 * Which theme to show, and how the toggle moves.
 *
 * Dark mode used to be opt-in only — `html{color-scheme:light}` plus a toggle that
 * wrote localStorage — so a phone set to dark still got a bright cream app. Apple's
 * HIG expects the system setting to be honoured.
 *
 * Two rules, and their order is the design: an explicit choice always beats the
 * system, and the system is the default. Someone who deliberately picked light must
 * not be flipped to dark at sunset.
 *
 * Deliberately NOT done in CSS. The obvious approach —
 * `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { … } }` — would
 * require duplicating the entire dark token block that already exists under
 * `[data-theme="dark"]`, and two copies of a palette drift. Instead the theme is
 * resolved to an attribute BEFORE first paint (see the inline script in
 * app/layout.tsx), so prototype.css keeps exactly one dark block and one source of
 * truth.
 */

export type Theme = "light" | "dark";

/** localStorage key. Shared by the pre-paint script and the toggle, so it cannot drift. */
export const THEME_STORAGE_KEY = "mallet-theme";

const isTheme = (value: unknown): value is Theme => value === "light" || value === "dark";

/**
 * @param stored      raw localStorage value — untrusted: user-writable, survives
 *                    deploys, and may be stale or hand-edited.
 * @param prefersDark the system preference.
 */
export function resolveInitialTheme(stored: string | null, prefersDark: boolean): Theme {
  if (isTheme(stored)) return stored;
  return prefersDark ? "dark" : "light";
}

/** The toggle flips whatever is EFFECTIVE, which is not necessarily light. */
export function nextTheme(current: Theme): Theme {
  return current === "dark" ? "light" : "dark";
}

/**
 * Runs in `<head>` before first paint, so a system-dark phone never flashes cream.
 * Kept as a string because it must be inlined and blocking — a React effect runs
 * after paint, which is the flash we are avoiding.
 *
 * Mirrors resolveInitialTheme above. It is duplicated ON PURPOSE (this has to be
 * dependency-free, pre-hydration, ES5-safe) and lib/theme.test.ts documents the
 * behaviour both must share. Wrapped in try/catch because localStorage throws
 * outright in some privacy modes, and a theme is never worth a blank page.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var d=document.documentElement;
if(d.getAttribute('data-theme')==='light'||d.getAttribute('data-theme')==='dark')return;
var s=localStorage.getItem('${THEME_STORAGE_KEY}');
var t=(s==='light'||s==='dark')?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
d.setAttribute('data-theme',t);
}catch(e){}})();`;
