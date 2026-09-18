/**
 * lib/theme.ts
 * The app is LIGHT. One look, committed.
 *
 * Dark mode had a full stack here once — a system-preference resolver, a topbar toggle, a
 * localStorage choice, a pre-paint script. Cut Aug 2026 (Owen): the app commits to its one
 * look, and the corner toggle was chrome nobody asked for. The dark token block in
 * prototype.css stays dormant behind [data-theme="dark"], which nothing sets any more.
 *
 * What remains is the CLEAN-UP script: anyone who ever tapped the old toggle has
 * `mallet-theme: dark` in localStorage and `data-theme` stamped by the old pre-paint script —
 * without this, removing the toggle would LOCK those users in dark with no way back. It runs
 * pre-paint for the same reason the old resolver did: an effect runs after paint, and a dark
 * flash on a cream app is the exact class of bug this file exists to prevent.
 */

/** localStorage key the retired toggle wrote — the clean-up script clears it. */
export const THEME_STORAGE_KEY = "mallet-theme";

/**
 * Runs in `<head>` before first paint. Dependency-free, pre-hydration, ES5-safe; wrapped in
 * try/catch because localStorage throws outright in some privacy modes, and theme hygiene is
 * never worth a blank page.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
document.documentElement.removeAttribute('data-theme');
localStorage.removeItem('${THEME_STORAGE_KEY}');
}catch(e){}})();`;
