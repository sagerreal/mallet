import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { orgs, users } from "@mallet/shared/db/schema";
import { withTenant } from "@mallet/shared/db/tx";
import { asOrgId } from "@mallet/shared/types";
import { router, authedNoPrincipal, anyRole, ownerOrOffice } from "@/trpc/init";
import { ROLES } from "../domain/principal";

const roleEnum = z.enum(ROLES as unknown as ["owner", "office", "tech"]);
const meDTO = z.object({ role: roleEnum, orgId: z.string().uuid(), orgName: z.string(), email: z.string() });

const orgNameOf = async (orgId: string): Promise<string> =>
  withTenant(asOrgId(orgId), async (tx) => {
    const [row] = await tx.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, orgId));
    return row?.name ?? "";
  });

export const createIdentityRouter = () =>
  router({
    // Idempotent provisioning: called once after any login. An unmapped (new) identity gets an org
    // created via the SECURITY DEFINER seam; an already-provisioned one gets its org back.
    signup: authedNoPrincipal
      .input(z.object({ orgName: z.string().min(1).max(80).optional() }))
      .output(meDTO)
      .mutation(async ({ ctx, input }) => {
        if (ctx.principal) {
          const email = ctx.unmapped?.email ?? "";
          return { role: ctx.principal.role, orgId: ctx.principal.orgId, orgName: await orgNameOf(ctx.principal.orgId), email };
        }
        const unmapped = ctx.unmapped;
        if (!unmapped) throw new TRPCError({ code: "UNAUTHORIZED", message: "authentication required" });
        const orgName = input.orgName ?? unmapped.orgNameHint ?? "My business";
        const provisioned = await ctx.deps.signupStore.createOrgForUser({
          authUserId: unmapped.authUserId,
          email: unmapped.email,
          orgName,
        });
        const role = roleEnum.parse(provisioned.role);
        return { role, orgId: provisioned.orgId, orgName: await orgNameOf(provisioned.orgId), email: unmapped.email };
      }),

    // Who am I + which org — what the shell routes on. Any role.
    me: anyRole.output(meDTO).query(async ({ ctx }) => {
      const [org] = await ctx.tx.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, ctx.principal.orgId));
      const [self] = await ctx.tx.select({ email: users.email }).from(users).where(eq(users.id, ctx.principal.userId));
      return { role: ctx.principal.role, orgId: ctx.principal.orgId, orgName: org?.name ?? "", email: self?.email ?? "" };
    }),

    // The org's people — feeds the Jobs assign picker. Office-side only.
    members: ownerOrOffice
      .output(z.object({ items: z.array(z.object({ id: z.string().uuid(), email: z.string(), role: roleEnum })) }))
      .query(async ({ ctx }) => {
        const rows = await ctx.tx.select({ id: users.id, email: users.email, role: users.role }).from(users);
        return { items: rows.map((r) => ({ id: r.id, email: r.email, role: roleEnum.parse(r.role) })) };
      }),
  });
