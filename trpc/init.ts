import { randomUUID } from "node:crypto";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { withTenant } from "@mallet/shared/db/tx";
import type { TenantTx } from "@mallet/shared/db/tx";
import { OutboxEventBus } from "@mallet/shared/outbox";
import { runWithContext, enrichRequestContext, logger } from "@mallet/shared/observability";
import type { Principal, Role, VerifiedToken } from "@mallet/identity";
import { formatAppError } from "./errors";
import type { AppDeps } from "./deps";

// Request context. `principal`/`tx` are null on the base context and narrowed to non-null by
// the auth/org-tx middlewares, so a procedure built on `ownerOrOffice` sees them as present.
export interface Context {
  readonly principal: Principal | null;
  // Verified Supabase identity that has NO users-row yet (signup-in-progress). Set only when the
  // token verifies but principal resolution fails; consumed exclusively by identity.signup.
  readonly unmapped: VerifiedToken | null;
  readonly tx: TenantTx | null;
  readonly deps: AppDeps;
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  // Domain refusals are TAGGED as well as worded (see toTRPCError). Copy the tag onto the error
  // data so a client can branch on which rule refused instead of matching the sentence it wrote.
  // An INPUT rejection is flattened to a sentence here (its message is the serialized Zod issues),
  // and an INTERNAL_SERVER_ERROR's message — whatever library threw it, Drizzle writes the SQL —
  // never leaves. Everything else is returned exactly as tRPC shaped it. See formatAppError.
  errorFormatter: formatAppError,
});

export const router = t.router;

// Outermost middleware on every procedure: establish a request-scoped context (so logs are
// correlated + tenant-attributed) and log the call's outcome and duration.
const withObservability = t.middleware(async ({ next, path, type }) =>
  runWithContext({ requestId: randomUUID() }, async () => {
    const startedAt = Date.now();
    const result = await next();
    logger.info({ path, type, ok: result.ok, durationMs: Date.now() - startedAt }, "trpc.request");
    return result;
  }),
);

export const publicProcedure = t.procedure.use(withObservability);

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
  // Tag the request context now that the tenant is known, so all downstream logs carry it.
  enrichRequestContext({ orgId: ctx.principal.orgId, userId: ctx.principal.userId });
  const orgId = ctx.principal.orgId;
  // Bind the event bus to THIS tx so a use-case's emits land in the outbox atomically with its
  // state change (durable, and rolled back together on failure) — replacing the in-memory bus.
  //
  // ROLLBACK ON ERROR: tRPC's next() does NOT reject when the resolver throws — it resolves
  // with { ok: false, error }. Left unchecked, withTenant would COMMIT any writes (and outbox
  // events) made before the throw. Re-throw the resolver's error inside the tx callback so the
  // transaction genuinely rolls back; tRPC maps the re-thrown error identically for the client.
  return withTenant(orgId, async (tx) => {
    const result = await next({ ctx: { tx, deps: { ...ctx.deps, bus: new OutboxEventBus(tx, orgId) } } });
    if (!result.ok) throw result.error;
    return result;
  });
});

// Owner/office staff, inside their org transaction. The standard procedure for back-office data.
export const ownerOrOffice = publicProcedure
  .use(requireAuth)
  .use(requireRole(["owner", "office"]))
  .use(orgTx);

// Owner/office staff, authenticated + role-checked but WITHOUT the org transaction — for handlers
// that manage their own short transactions rather than holding one open across slow work. The AI
// agent uses this: it opens a fresh withTenant tx PER tool call (with an outbox-bound bus, exactly
// like orgTx) around each action, never holding one tx across the multi-round-trip model loop.
export const ownerOrOfficeNoTx = publicProcedure.use(requireAuth).use(requireRole(["owner", "office"]));

// Any org member (owner/office/tech), authenticated + role-checked but WITHOUT the org transaction.
// Used by endpoints that manage their own per-operation short transactions (e.g. the field copilot
// agent loop, which must not hold a single DB tx open across multi-round-trip model calls).
export const anyRoleNoTx = publicProcedure.use(requireAuth).use(requireRole(["owner", "office", "tech"]));

// Authenticated Supabase identity, provisioned OR NOT — the signup entry point. Everything else
// requires a full principal.
const requireVerifiedIdentity = t.middleware(({ ctx, next }) => {
  if (!ctx.principal && !ctx.unmapped) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "authentication required" });
  }
  return next();
});
export const authedNoPrincipal = publicProcedure.use(requireVerifiedIdentity);

// Any org member (owner/office/tech), inside their org transaction — for surfaces every role uses
// (identity.me, the field view).
export const anyRole = publicProcedure.use(requireAuth).use(requireRole(["owner", "office", "tech"])).use(orgTx);
