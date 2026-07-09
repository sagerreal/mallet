import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, count, eq } from "drizzle-orm";
import { orgs, users, orgInvites } from "@mallet/shared/db/schema";
import { withTenant } from "@mallet/shared/db/tx";
import { asOrgId, asUserId } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { loadConfig } from "@mallet/shared/config";
import { router, authedNoPrincipal, anyRole, ownerOrOffice } from "@/trpc/init";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ROLES } from "../domain/principal";

const roleEnum = z.enum(ROLES as unknown as ["owner", "office", "tech"]);
const meDTO = z.object({ role: roleEnum, orgId: z.string().uuid(), orgName: z.string(), email: z.string(), name: z.string().nullable(), userId: z.string().uuid() });

// Result shape for the email-send attempt. `sent` is the source of truth; `reason` is a
// machine-readable code for the UI to surface a fallback message when `sent` is false.
interface InviteEmailResult {
  readonly sent: boolean;
  readonly reason?: string;
}

// Send a Supabase magic-link invite via the service-role admin client.
// Returns {sent:true} on success.
// Returns {sent:false, reason} on any failure — NEVER throws.
// Never logs the email address (PII) in any branch.
async function sendInviteEmail(email: string, orgId: string): Promise<InviteEmailResult> {
  try {
    const admin = getSupabaseAdmin();

    // Determine the redirectTo URL. PUBLIC_APP_URL is read from the validated config singleton so
    // it goes through Zod's z.url() check at boot rather than reaching here raw; fall back to a
    // relative path that Supabase will expand using the Site URL configured in the project dashboard.
    const appUrl = loadConfig().PUBLIC_APP_URL ?? "";
    // After the invited user clicks the link, /auth/callback establishes the session, then
    // forwards them to set-password so they can choose a password before entering the app.
    // The `next` param is validated by safeNext inside the callback route (open-redirect guard).
    const callbackBase = appUrl ? `${appUrl}/auth/callback` : "/auth/callback";
    const redirectTo = `${callbackBase}?next=/auth/set-password`;

    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: {
        // Embed the orgId so join-on-signup can surface it if needed (the pending org_invites row
        // is the real gate — this is informational context on the auth user record).
        invited_org_id: orgId,
      },
    });

    if (!error) {
      logger.info({ orgId }, "member.invite_email_sent");
      return { sent: true };
    }

    // Supabase returns a specific error when the email is already registered.
    // The pending invite row still exists — if they sign in they join automatically.
    // Note: a user already in *another* org won't auto-join this org; that's a known limitation
    // documented in the signup store's SECURITY DEFINER fn.
    const isAlreadyRegistered =
      error.message.toLowerCase().includes("user already registered") ||
      error.message.toLowerCase().includes("already been invited");

    if (isAlreadyRegistered) {
      logger.info({ orgId }, "member.invite_email_skipped: existing_account");
      return { sent: false, reason: "existing_account" };
    }

    // Other Supabase errors (SMTP not configured, rate limit, transient).
    logger.warn({ orgId, code: error.status ?? "unknown" }, "member.invite_email_failed");
    return { sent: false, reason: "send_failed" };
  } catch (unknownErr: unknown) {
    // Catch synchronous errors (e.g. missing env vars, admin client init failure).
    const msg = unknownErr instanceof Error ? unknownErr.message : "unknown";
    logger.warn({ orgId, detail: msg }, "member.invite_email_error");
    return { sent: false, reason: "send_failed" };
  }
}

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
          const principal = ctx.principal;
          const email = ctx.unmapped?.email ?? "";
          const userName = await withTenant(asOrgId(principal.orgId), async (tx) => {
            const [row] = await tx.select({ name: users.name }).from(users).where(eq(users.id, principal.userId));
            return row?.name ?? null;
          });
          return { role: principal.role, orgId: principal.orgId, orgName: await orgNameOf(principal.orgId), email, name: userName, userId: principal.userId };
        }
        const unmapped = ctx.unmapped;
        if (!unmapped) throw new TRPCError({ code: "UNAUTHORIZED", message: "authentication required" });
        const orgName = input.orgName ?? unmapped.orgNameHint ?? "My business";
        const provisioned = await ctx.deps.signupStore.createOrgForUser({
          authUserId: unmapped.authUserId,
          email: unmapped.email,
          orgName,
          name: unmapped.name ?? null,
        });
        const role = roleEnum.parse(provisioned.role);
        // users.id is a distinct UUID from auth_user_id (the signup fn returns only org_id+role),
        // so resolve the real users-row id — meDTO.userId must match Tech.id / members.id everywhere.
        const newUserId = await withTenant(asOrgId(provisioned.orgId), async (tx) => {
          const [row] = await tx.select({ id: users.id }).from(users).where(eq(users.authUserId, unmapped.authUserId));
          return row?.id ?? null;
        });
        if (!newUserId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "provisioned user not found" });
        return { role, orgId: provisioned.orgId, orgName: await orgNameOf(provisioned.orgId), email: unmapped.email, name: unmapped.name ?? null, userId: newUserId };
      }),

    // Who am I + which org — what the shell routes on. Any role.
    me: anyRole.output(meDTO).query(async ({ ctx }) => {
      const [org] = await ctx.tx.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, ctx.principal.orgId));
      const [self] = await ctx.tx.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, ctx.principal.userId));
      return { role: ctx.principal.role, orgId: ctx.principal.orgId, orgName: org?.name ?? "", email: self?.email ?? "", name: self?.name ?? null, userId: ctx.principal.userId };
    }),

    // The org's people — feeds the Jobs assign picker. Office-side only.
    members: ownerOrOffice
      .output(
        z.object({
          items: z.array(
            z.object({
              id: z.string().uuid(),
              email: z.string(),
              role: roleEnum,
              name: z.string().nullable(),
              isFieldCrew: z.boolean(),
            }),
          ),
        }),
      )
      .query(async ({ ctx }) => {
        const rows = await ctx.tx
          .select({ id: users.id, email: users.email, role: users.role, name: users.name, isFieldCrew: users.isFieldCrew })
          .from(users)
          .where(eq(users.orgId, ctx.principal.orgId));
        return {
          items: rows.map((r) => ({
            id: r.id,
            email: r.email,
            role: roleEnum.parse(r.role),
            name: r.name ?? null,
            isFieldCrew: r.isFieldCrew,
          })),
        };
      }),

    // Let any authenticated user update their own display name.
    // The caller's user id comes from ctx.principal — never from client input.
    updateMe: anyRole
      .input(z.object({ name: z.string().min(1).max(120) }))
      .output(meDTO)
      .mutation(async ({ ctx, input }) => {
        const [updated] = await ctx.tx
          .update(users)
          .set({ name: input.name, updatedAt: new Date() })
          .where(eq(users.id, ctx.principal.userId))
          .returning({ email: users.email, name: users.name });

        if (!updated) {
          throw new TRPCError({ code: "NOT_FOUND", message: "user not found in this org" });
        }

        logger.info({ userId: ctx.principal.userId, orgId: ctx.principal.orgId }, "user.name_updated");

        return {
          role: ctx.principal.role,
          orgId: ctx.principal.orgId,
          orgName: await orgNameOf(ctx.principal.orgId),
          email: updated.email,
          name: updated.name ?? null,
          userId: ctx.principal.userId,
        };
      }),

    // Change a member's role. Restricted to owner/office. Cannot demote the last owner.
    setMemberRole: ownerOrOffice
      .input(z.object({ userId: z.string().uuid(), role: z.enum(["owner", "office", "tech"]) }))
      .output(
        z.object({
          id: z.string().uuid(),
          email: z.string(),
          role: roleEnum,
          name: z.string().nullable(),
          isFieldCrew: z.boolean(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Guard: fetch the current role of the target user so we know if we're demoting an owner.
        const [target] = await ctx.tx
          .select({ role: users.role })
          .from(users)
          .where(and(eq(users.id, asUserId(input.userId)), eq(users.orgId, ctx.principal.orgId)));

        if (!target) {
          throw new TRPCError({ code: "NOT_FOUND", message: "user not found in this org" });
        }

        // Only an owner may promote to owner or change an owner's role. Office/tech can only shuffle office<->tech.
        if ((input.role === "owner" || target.role === "owner") && ctx.principal.role !== "owner") {
          throw new TRPCError({ code: "FORBIDDEN", message: "only an owner can change owner roles" });
        }

        // If we're about to remove owner status, ensure this isn't the last owner.
        if (target.role === "owner" && input.role !== "owner") {
          const countRows = await ctx.tx
            .select({ value: count() })
            .from(users)
            .where(and(eq(users.orgId, ctx.principal.orgId), eq(users.role, "owner")));

          const ownerCount = Number(countRows[0]?.value ?? 0);
          if (ownerCount <= 1) {
            throw new TRPCError({ code: "FORBIDDEN", message: "cannot remove the last owner" });
          }
        }

        const [updated] = await ctx.tx
          .update(users)
          .set({ role: input.role, updatedAt: new Date() })
          .where(and(eq(users.id, asUserId(input.userId)), eq(users.orgId, ctx.principal.orgId)))
          .returning({ id: users.id, email: users.email, role: users.role, name: users.name, isFieldCrew: users.isFieldCrew });

        if (!updated) {
          throw new TRPCError({ code: "NOT_FOUND", message: "user not found in this org" });
        }

        logger.info(
          { actorUserId: ctx.principal.userId, targetUserId: input.userId, role: input.role, orgId: ctx.principal.orgId },
          "member.role_changed",
        );

        return {
          id: updated.id,
          email: updated.email,
          role: roleEnum.parse(updated.role),
          name: updated.name ?? null,
          isFieldCrew: updated.isFieldCrew,
        };
      }),

    // Invite a not-yet-signed-up email address to join the org with a given role.
    // The actual join happens inside the SECURITY DEFINER signup fn when that email first signs up.
    // Guard: only an owner may invite role='owner' (mirrors setMemberRole).
    inviteMember: ownerOrOffice
      .input(z.object({ email: z.string().email(), role: z.enum(["owner", "office", "tech"]) }))
      .output(
        z.object({
          id: z.string().uuid(),
          email: z.string(),
          role: roleEnum,
          status: z.string(),
          createdAt: z.date(),
          // Whether Supabase's invite email was dispatched. False when the address already has an
          // auth account (can't re-invite via Supabase) or when the admin client isn't configured.
          emailSent: z.boolean(),
          // Machine-readable reason when emailSent is false.
          emailReason: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.role === "owner" && ctx.principal.role !== "owner") {
          throw new TRPCError({ code: "FORBIDDEN", message: "only an owner can invite an owner" });
        }

        // Upsert: if a pending invite for this email already exists in the org, update its role.
        // Otherwise insert a fresh pending invite.
        const existing = await ctx.tx
          .select({ id: orgInvites.id })
          .from(orgInvites)
          .where(
            and(
              eq(orgInvites.orgId, ctx.principal.orgId),
              eq(orgInvites.email, input.email.toLowerCase()),
              eq(orgInvites.status, "pending"),
            ),
          )
          .limit(1);

        let row: { id: string; email: string; role: string; status: string; createdAt: Date };

        if (existing.length > 0) {
          const [updated] = await ctx.tx
            .update(orgInvites)
            .set({ role: input.role, updatedAt: new Date() })
            .where(
              and(
                eq(orgInvites.id, existing[0]!.id),
                eq(orgInvites.orgId, ctx.principal.orgId),
              ),
            )
            .returning({ id: orgInvites.id, email: orgInvites.email, role: orgInvites.role, status: orgInvites.status, createdAt: orgInvites.createdAt });
          if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "invite not found" });
          row = updated;
        } else {
          const [inserted] = await ctx.tx
            .insert(orgInvites)
            .values({
              orgId: ctx.principal.orgId,
              email: input.email.toLowerCase(),
              role: input.role,
              status: "pending",
              invitedByUserId: ctx.principal.userId,
            })
            .returning({ id: orgInvites.id, email: orgInvites.email, role: orgInvites.role, status: orgInvites.status, createdAt: orgInvites.createdAt });
          if (!inserted) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "failed to create invite" });
          row = inserted;
        }

        // Log action but never the email value (PII).
        logger.info({ orgId: ctx.principal.orgId, role: input.role, invitedByUserId: ctx.principal.userId }, "member.invited");

        // --- Send invite email via Supabase auth.admin.inviteUserByEmail ---
        // The pending org_invites row is the source of truth for join-on-signup — it MUST be
        // committed above regardless of email outcome. Email failure is non-fatal: we log a warning
        // and return emailSent:false so the owner knows they need to share a manual link.
        const emailResult = await sendInviteEmail(input.email, ctx.principal.orgId);

        return {
          id: row.id,
          email: row.email,
          role: roleEnum.parse(row.role),
          status: row.status,
          createdAt: row.createdAt,
          emailSent: emailResult.sent,
          emailReason: emailResult.reason,
        };
      }),

    // List pending invites for the caller's org. Owner/office only.
    listInvites: ownerOrOffice
      .output(
        z.object({
          items: z.array(
            z.object({
              id: z.string().uuid(),
              email: z.string(),
              role: roleEnum,
              status: z.string(),
              createdAt: z.date(),
            }),
          ),
        }),
      )
      .query(async ({ ctx }) => {
        const rows = await ctx.tx
          .select({
            id: orgInvites.id,
            email: orgInvites.email,
            role: orgInvites.role,
            status: orgInvites.status,
            createdAt: orgInvites.createdAt,
          })
          .from(orgInvites)
          .where(and(eq(orgInvites.orgId, ctx.principal.orgId), eq(orgInvites.status, "pending")));

        return {
          items: rows.map((r) => ({
            id: r.id,
            email: r.email,
            role: roleEnum.parse(r.role),
            status: r.status,
            createdAt: r.createdAt,
          })),
        };
      }),

    // Revoke a pending invite so it will no longer trigger an auto-join on signup.
    // Only matches pending invites in the caller's own org (explicit orgId + RLS double-lock).
    revokeInvite: ownerOrOffice
      .input(z.object({ inviteId: z.string().uuid() }))
      .output(z.object({ ok: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.tx
          .update(orgInvites)
          .set({ status: "revoked", updatedAt: new Date() })
          .where(
            and(
              eq(orgInvites.id, input.inviteId),
              eq(orgInvites.orgId, ctx.principal.orgId),
              eq(orgInvites.status, "pending"),
            ),
          )
          .returning({ id: orgInvites.id });

        if (result.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "pending invite not found in this org" });
        }

        logger.info({ inviteId: input.inviteId, orgId: ctx.principal.orgId, actorUserId: ctx.principal.userId }, "member.invite_revoked");

        return { ok: true };
      }),

    // Toggle whether a member appears on the schedule board as assignable crew.
    // Restricted to owner/office — field techs cannot flip their own flag.
    setMemberFieldCrew: ownerOrOffice
      .input(z.object({ userId: z.string().uuid(), isFieldCrew: z.boolean() }))
      .output(
        z.object({
          id: z.string().uuid(),
          email: z.string(),
          role: roleEnum,
          name: z.string().nullable(),
          isFieldCrew: z.boolean(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [updated] = await ctx.tx
          .update(users)
          .set({ isFieldCrew: input.isFieldCrew, updatedAt: new Date() })
          .where(and(eq(users.id, asUserId(input.userId)), eq(users.orgId, ctx.principal.orgId)))
          .returning({ id: users.id, email: users.email, role: users.role, name: users.name, isFieldCrew: users.isFieldCrew });

        if (!updated) {
          throw new TRPCError({ code: "NOT_FOUND", message: "user not found in this org" });
        }

        logger.info(
          { targetUserId: input.userId, isFieldCrew: input.isFieldCrew, actorUserId: ctx.principal.userId },
          "identity.setMemberFieldCrew",
        );

        return {
          id: updated.id,
          email: updated.email,
          role: roleEnum.parse(updated.role),
          name: updated.name ?? null,
          isFieldCrew: updated.isFieldCrew,
        };
      }),
  });
