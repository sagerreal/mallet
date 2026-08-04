import "server-only";
import type { Principal } from "@mallet/identity";
import { logger } from "@mallet/shared/observability";
import { appRouter } from "@/trpc/root";
import { getAppDeps } from "@/trpc/di";
import { measurementGateFrom, type MeasurementGate } from "@/lib/measurement-gate";

/**
 * lib/auth/server-measurement-gate.ts
 *
 * Resolve "does this shop price off measurements?" SERVER-SIDE, in the layout, so the very first
 * HTML already knows — exactly the way `resolveMe` resolves the shell identity (lib/auth/server-me.ts)
 * and for the same reason.
 *
 * WHY. The gate's only writers were client hydrators, so it started `"unknown"` on every cold load
 * and `"unknown"` fails OPEN (lib/measurement-gate.ts). That is right for a FAILED read and wrong
 * for a read that simply has not happened yet: the composer's Measure card and the field Quote
 * tab's "Scan a room" row rendered, then VANISHED a beat later when settings landed. Non-measuring
 * trades are plumbing/HVAC/electrical — the beachhead — so that appear-then-disappear was the
 * majority experience, and it is the exact defect the repo's hydration-flash rule exists to
 * prevent (a store-derived surface must not paint before its value is known).
 *
 * A client-side seed cannot fix it. These pages are client components under SSR'd layouts, so the
 * server HTML is painted long before React hydrates; whatever the store holds at module load is
 * what the user sees first. The value therefore has to travel from the server INTO the render, and
 * the layout is where the principal already is.
 *
 * FAILS SOFT TO `"unknown"`, like `resolveMe` fails soft to `undefined`: a settings read that
 * errors must degrade to "we do not know" (visible, disabled, reason shown) and never 500 the page
 * or fabricate an answer. `"unknown"` is now what it always claimed to be — a genuine read
 * failure — rather than the ordinary state of every first paint.
 *
 * Cost: one `getConfig` select per office/field page load, on the same tenant transaction the
 * layout's guard already established.
 */
export async function resolveMeasurementGate(principal: Principal): Promise<MeasurementGate> {
  try {
    const ctx = { principal, unmapped: null, tx: null, deps: getAppDeps() };
    const toggles = await appRouter.createCaller(ctx).v1.settings.fieldToggles();
    return measurementGateFrom(toggles.measurementEstimating);
  } catch (error: unknown) {
    logger.warn({ err: error }, "shell.resolveMeasurementGate.failed");
    return "unknown";
  }
}
