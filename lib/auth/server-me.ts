import "server-only";
import type { Principal } from "@mallet/identity";
import { logger } from "@mallet/shared/observability";
import { appRouter } from "@/trpc/root";
import { getAppDeps } from "@/trpc/di";
import type { RouterOutputs } from "@/lib/trpc/client";

export type MeInitial = RouterOutputs["v1"]["identity"]["me"];

// Resolve the shell identity (role + org + email) server-side, reusing the REAL
// v1.identity.me resolver (its anyRole tenant tx keeps this RLS-scoped) so the
// client shell can paint the correct nav + account on its FIRST render instead
// of flashing a cold, field-only, "You / My Business" state while a client-side
// useMe() round-trips. The principal is already resolved by guardRole in the
// layout, so this adds only the two me selects (org name + user email).
//
// Fails soft: on any error we return undefined and the shell falls back to the
// client-side fetch (the prior behaviour) rather than 500-ing the whole page.
export async function resolveMe(principal: Principal): Promise<MeInitial | undefined> {
  try {
    const ctx = { principal, unmapped: null, tx: null, deps: getAppDeps() };
    return await appRouter.createCaller(ctx).v1.identity.me();
  } catch (error: unknown) {
    logger.warn({ err: error }, "shell.resolveMe.failed");
    return undefined;
  }
}
