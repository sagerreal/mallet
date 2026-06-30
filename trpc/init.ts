import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { withTenant } from "@mallet/shared/db/tx";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { Principal, Role } from "@mallet/identity";
import type { AppDeps } from "./deps";

// Request context. `principal`/`tx` are null on the base context and narrowed to non-null by
// the auth/org-tx middlewares, so a procedure built on `ownerOrOffice` sees them as present.
export interface Context {
  readonly principal: Principal | null;
  readonly tx: TenantTx | null;
  readonly deps: AppDeps;
}

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

// Reject anonymous callers and narrow `principal` to non-null for everything downstream.
const requireAuth = t.middleware(({ ctx, next }) => {
  if (!ctx.principal) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "authentication required" });
  }
  return next({ ctx: { principal: ctx.principal } });
});

const requireRole = (allowed: readonly Role[]) =>
  t.middleware(({ ctx, next }) => {
    if (!ctx.principal || !allowed.includes(ctx.principal.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "insufficient role" });
    }
    return next();
  });

// Open an org-scoped transaction for the whole resolver. withTenant sets app.current_org_id from
// the authenticated principal — the org is NEVER taken from input — and commits on success /
// rolls back on throw. Adds the live `tx` to context.
const orgTx = t.middleware(({ ctx, next }) => {
  if (!ctx.principal) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "authentication required" });
  }
  return withTenant(ctx.principal.orgId, (tx) => next({ ctx: { tx } }));
});

// Owner/office staff, inside their org transaction. The standard procedure for back-office data.
export const ownerOrOffice = publicProcedure
  .use(requireAuth)
  .use(requireRole(["owner", "office"]))
  .use(orgTx);
