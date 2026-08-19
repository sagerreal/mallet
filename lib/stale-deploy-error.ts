/**
 * lib/stale-deploy-error.ts
 * Is this crash a stale client asking for chunks a newer deploy replaced?
 *
 * Prod auto-deploys on merge, and a tab left open across a deploy keeps the old build's chunk
 * manifest. The next route it lazy-loads asks for a hashed file the new deploy no longer serves,
 * the import rejects, and the route error boundary shows "Something went wrong" for what is
 * really "the app updated underneath you". The right fix for that state is a reload — it fetches
 * the new build — not a Try again button that re-runs the same doomed import.
 */

/** What Webpack/Turbopack and the three browser engines actually say when a chunk 404s. */
const STALE_DEPLOY_SIGNATURES = [
  /loading chunk [^\s]+ failed/i,
  /failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /importing a module script failed/i, // Safari
];

export function isStaleDeployError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "ChunkLoadError") return true;
  return STALE_DEPLOY_SIGNATURES.some((sig) => sig.test(error.message));
}
