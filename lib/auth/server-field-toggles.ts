import "server-only";
import type { Principal } from "@mallet/identity";
import { logger } from "@mallet/shared/observability";
import { appRouter } from "@/trpc/root";
import { getAppDeps } from "@/trpc/di";
import { measurementGateFrom } from "@/lib/measurement-gate";
import type { FieldTogglesSeed } from "@/lib/field-toggles-seed";

/**
 * lib/auth/server-field-toggles.ts
 *
 * Resolve the org's FIELD CAPABILITY FLAGS server-side, in the layout, so the very first HTML
 * already knows them — exactly the way `resolveMe` resolves the shell identity
 * (lib/auth/server-me.ts) and for the same reason.
 *
 * WHY. Both flags' only writers were client hydrators, so both sat at their placeholder on every
 * cold load and the surfaces reading them CHANGED SHAPE a beat after first paint:
 *
 *   - `measurementEstimating` started `"unknown"`, which fails OPEN, so the composer's Measure
 *     card and the field Quote tab's "Scan a room" row rendered and then VANISHED once settings
 *     landed. Non-measuring trades are the beachhead, so that was the majority experience.
 *   - `canText` started absent, which fails CLOSED (features/messaging/use-can-text.tsx), so the
 *     tech job sheet painted Call alone and Text APPEARED a beat later. Fail-closed is the right
 *     answer for a read that failed; it is the wrong answer for a read that simply has not
 *     happened yet, and it bought the absent→present flash to avoid the present→absent one.
 *
 * A client-side seed cannot fix either. These pages are client components under SSR'd layouts, so
 * the server HTML is painted long before React hydrates; whatever the store or an empty query
 * cache holds at module load is what the user sees first. The values therefore have to travel from
 * the server INTO the render, and the layout is where the principal already is.
 *
 * ONE READ, EVERY FACT. `v1.settings.fieldToggles` is a single `anyRole` query, and this resolver
 * was already calling it and dropping fields on the floor — `canText` first, then the OVERTIME
 * RULE, which arrived on the same payload and had the same problem in a worse place: My hours
 * computes a technician's overtime from it, so an unseeded read painted the FEDERAL figure and
 * then corrected itself. On a California week that is "no overtime" flashing into "8.00 OT" —
 * the exact number the policy exists to get right, wrong for a beat. Seeding adds no request.
 *
 * FAILS SOFT TO `"unknown"`, like `resolveMe` fails soft to `undefined`: a settings read that
 * errors must degrade to "we do not know" and never 500 the page or fabricate an answer. Each
 * reader then decides which way `"unknown"` falls — the scan surfaces fail open into a disabled
 * control with a stated reason (lib/measurement-gate.ts), Text fails closed, because a control
 * the carrier is certain to refuse is worse than no control.
 *
 * Cost: one `getConfig` select + one a2p status read per office/field page load, on the same
 * tenant transaction the layout's guard already established.
 */

const UNRESOLVED: FieldTogglesSeed = { measurement: "unknown", canText: "unknown", overtime: null };

export async function resolveFieldToggles(principal: Principal): Promise<FieldTogglesSeed> {
  try {
    const ctx = { principal, unmapped: null, tx: null, deps: getAppDeps() };
    const toggles = await appRouter.createCaller(ctx).v1.settings.fieldToggles();
    return {
      measurement: measurementGateFrom(toggles.measurementEstimating),
      canText: toggles.canText ? "yes" : "no",
      overtime: toggles.overtime,
    };
  } catch (error: unknown) {
    logger.warn({ err: error }, "shell.resolveFieldToggles.failed");
    return UNRESOLVED;
  }
}
