import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, count, eq } from "drizzle-orm";
import { orgs, users, orgInvites } from "@mallet/shared/db/schema";
import { withTenant, type TenantTx } from "@mallet/shared/db/tx";
import { asOrgId, asUserId, isOk } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { loadConfig } from "@mallet/shared/config";
import { router, authedNoPrincipal, anyRole, ownerOrOffice } from "@/trpc/init";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { normCert } from "@mallet/shared/dispatch/skill-gate";
import { ROLES, type Principal } from "../domain/principal";
import { ProvisionOrgNumberUseCase } from "@mallet/a2p";
import { playbookFor, TRADE_KEYS } from "@/app/(office)/settings/trade-playbooks";
import { DrizzleSettingsRepository, defaultBooking } from "@mallet/settings";

const roleEnum = z.enum(ROLES as unknown as ["owner", "office", "tech"]);
// `callbackNumber` is the mobile Elas rings first on an outbound click-to-call. A call RECORD
// deliberately keeps it off the wire (it can name a colleague — staff PII); `me` is scoped to
// ctx.principal.userId, so it only ever returns the caller their own number.
const meDTO = z.object({ role: roleEnum, orgId: z.string().uuid(), orgName: z.string(), twilioNumber: z.string().nullable(), email: z.string(), name: z.string().nullable(), userId: z.string().uuid(), callbackNumber: z.string().nullable() });
type MeShape = z.infer<typeof meDTO>;

// EVERY meDTO is built here. Four sites used to assemble the object literal by hand and had already
// drifted apart — three hard-coded `twilioNumber: null` while `me` read the real value, so whether
// the shell saw the business number depended on which call it adopted. One builder means a new
// field cannot be half-added.
const loadMeDTO = async (tx: TenantTx, principal: Principal): Promise<MeShape> => {
  const [org] = await tx
    .select({ name: orgs.name, twilioNumber: orgs.twilioNumber })
    .from(orgs)
    .where(eq(orgs.id, principal.orgId));
  const [self] = await tx
    .select({ email: users.email, name: users.name, callbackNumber: users.callbackNumber })
    .from(users)
    .where(eq(users.id, principal.userId));
  return {
    role: principal.role,
    orgId: principal.orgId,
    orgName: org?.name ?? "",
    twilioNumber: org?.twilioNumber ?? null,
    email: self?.email ?? "",
    name: self?.name ?? null,
    userId: principal.userId,
    callbackNumber: self?.callbackNumber ?? null,
  };
};

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
    // After the invited user clicks the link, /auth/confirm verifies the token_hash and routes
    // them to /set-password (the type=invite default in confirmDestination).
    // No ?next param is needed — the type default handles it and avoids any unsafe query on the
    // Supabase {{ .RedirectTo }} substitution.
    const redirectTo = appUrl ? `${appUrl}/auth/confirm` : "/auth/confirm";

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

export const createIdentityRouter = () =>
  router({
    // Idempotent provisioning: called once after any login. An unmapped (new) identity gets an org
    // created via the SECURITY DEFINER seam; an already-provisioned one gets its org back.
    signup: authedNoPrincipal
      .input(
        z.object({
          orgName: z.string().min(1).max(80).optional(),
          // Collected on the signup form purely so the shop's business number has a LOCAL area
          // code. A plumber in Weymouth handing customers a 669 California number looks wrong.
          postalCode: z.string().regex(/^\d{5}$/).optional(),
          // Derived from the ZIP on the client (lib/geo/zip-timezone). Absent when the ZIP is
          // outside the table — the org then keeps the column default rather than a guess.
          timezone: z.string().min(1).max(64).optional(),
          // A TRADE_PLAYBOOKS key. Decides the front desk's starter services and, later, which
          // pricebook the shop is offered. Validated against the real list rather than as free
          // text, so a stale client cannot write a trade nothing in the app knows about.
          trade: z.enum(TRADE_KEYS).optional(),
        }),
      )
      .output(meDTO)
      .mutation(async ({ ctx, input }) => {
        if (ctx.principal) {
          const principal = ctx.principal;
          // signup runs on authedNoPrincipal, so there is no ctx.tx — it opens its own tenant tx.
          const me = await withTenant(asOrgId(principal.orgId), (tx) => loadMeDTO(tx, principal));
          // The auth identity's email is the freshest one when the users row has not caught up.
          return { ...me, email: ctx.unmapped?.email ?? me.email };
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
        const me = await withTenant(asOrgId(provisioned.orgId), async (tx) => {
          const [row] = await tx.select({ id: users.id }).from(users).where(eq(users.authUserId, unmapped.authUserId));
          if (!row) return null;
          return loadMeDTO(tx, { role, orgId: asOrgId(provisioned.orgId), userId: asUserId(row.id) });
        });
        if (!me) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "provisioned user not found" });

        // Buy the shop its business line. AWAITED but never allowed to fail the signup: a Twilio
        // outage must not read to a new customer as "Elas is broken, I could not even sign up".
        // The Front Desk header already renders "Getting your number — we'll email you when it's
        // live" while orgs.twilio_number is null, so no-number-yet is a designed state.
        //
        // Awaited rather than fired-and-forgotten because a serverless function can be frozen the
        // moment it responds — a detached promise here would be killed mid-purchase, sometimes
        // AFTER Twilio had already charged for the number.
        if (ctx.deps.numberProvisioner) {
          try {
            const provision = new ProvisionOrgNumberUseCase(ctx.deps.numberProvisioner, ctx.deps.voiceRegistrar);
            await provision.exec({
              orgId: asOrgId(provisioned.orgId),
              postalCode: input.postalCode ?? null,
            });
          } catch (error) {
            logger.error(
              { err: error instanceof Error ? error.message : String(error), orgId: provisioned.orgId },
              "signup.number_provision_threw",
            );
          }
        }

        // Timezone derived client-side from the ZIP (lib/geo/zip-timezone). Absent when the ZIP
        // fell outside that table — the org keeps its column default rather than a silent guess.
        //
        // ONLY for a genuinely brand-new org: `provisioned` also covers the invited-joiner path
        // (app_signup_create_org joins a pending invite into an EXISTING org and returns ITS id +
        // the invited role — this is not "create a new org" every time). Patching unconditionally
        // would let an invited tech's ZIP silently revert a timezone the owner had already
        // corrected in Settings, and would do it through a role (`authedNoPrincipal`) that bypasses
        // the `ownerOrOffice` guard on settings.updateConfig. Both conditions below must hold:
        // the provisioned role is 'owner', AND no org_settings row exists yet for that org — read
        // BEFORE calling getConfig, whose lazy insert would otherwise make every org look
        // pre-existing by the time anything checks.
        //
        // Wrapped in try/catch and placed after number provisioning (not before it): this write is
        // best-effort, not the point of signup. `createOrgForUser` already committed on its own
        // SECURITY DEFINER connection, so an unguarded throw here used to 500 the whole mutation —
        // and because the identity was already mapped, a retry took the `if (ctx.principal)` early
        // return above and never reached number provisioning again, permanently stranding the org
        // with twilio_number = null. Matches the adjacent Twilio block's pattern for the same reason.
        if ((input.timezone || input.trade) && role === "owner") {
          try {
            await withTenant(asOrgId(provisioned.orgId), async (tx) => {
              const repo = new DrizzleSettingsRepository(tx, asOrgId(provisioned.orgId));
              const alreadyHasSettings = await repo.hasConfig();
              if (alreadyHasSettings) return;
              const settings = await repo.getConfig(provisioned.orgId, defaultBooking);

              // The trade's starter playbook becomes the front desk's bookable services. Before
              // this, defaultBooking() handed EVERY org nine hard-coded plumbing services with
              // invented flat prices ("Drain cleaning $99", "Sewer camera inspection $285") — a
              // roofing shop's AI receptionist would have quoted those to its callers. The
              // playbooks carry no prices at all, on the standing rule that prices are the
              // owner's and never ours.
              //
              // A trade with no playbook (including "other") gets an EMPTY service list rather
              // than another trade's — the same rule the pricebook registry follows. Empty is
              // also what keeps the front desk switched off, since frontDeskReadiness requires at
              // least one bookable service.
              const playbook = input.trade ? playbookFor(input.trade) : undefined;
              const booking = playbook
                ? { ...settings.props.booking, services: [...playbook.services] }
                : settings.props.booking;

              const patched = settings.patch(
                {
                  ...(input.timezone ? { timezone: input.timezone } : {}),
                  ...(input.trade ? { trade: input.trade, booking } : {}),
                },
                ctx.deps.clock.now(),
              );
              if (isOk(patched)) {
                await repo.saveConfig(patched.value);
              } else {
                logger.warn(
                  { orgId: provisioned.orgId, timezone: input.timezone, trade: input.trade, reason: patched.error.message },
                  "signup.first_run_settings_rejected",
                );
              }
            });
          } catch (error) {
            logger.error(
              { err: error instanceof Error ? error.message : String(error), orgId: provisioned.orgId },
              "signup.first_run_settings_threw",
            );
          }
        }

        return { ...me, email: unmapped.email, name: me.name ?? unmapped.name ?? null };
      }),

    // Who am I + which org — what the shell routes on. Any role.
    me: anyRole.output(meDTO).query(({ ctx }) => loadMeDTO(ctx.tx, ctx.principal)),

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
              takesCalls: z.boolean(),
              skillTags: z.array(z.string()),
            }),
          ),
        }),
      )
      .query(async ({ ctx }) => {
        const rows = await ctx.tx
          .select({ id: users.id, email: users.email, role: users.role, name: users.name, isFieldCrew: users.isFieldCrew, takesCalls: users.takesCalls, skillTags: users.skillTags })
          .from(users)
          .where(eq(users.orgId, ctx.principal.orgId));
        return {
          items: rows.map((r) => ({
            id: r.id,
            email: r.email,
            role: roleEnum.parse(r.role),
            name: r.name ?? null,
            isFieldCrew: r.isFieldCrew,
            takesCalls: r.takesCalls,
            skillTags: r.skillTags ?? [],
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
          .returning({ id: users.id });

        if (!updated) {
          throw new TRPCError({ code: "NOT_FOUND", message: "user not found in this org" });
        }

        logger.info({ userId: ctx.principal.userId, orgId: ctx.principal.orgId }, "user.name_updated");

        // Re-read through the one builder rather than assembling a second literal: this used to
        // return twilioNumber: null, so a shell that adopted the response lost the business number.
        return loadMeDTO(ctx.tx, ctx.principal);
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
    // Whether the AI front desk may put an urgent caller through to this person. Their HOURS come
    // from crew_schedules — this is only "may they be interrupted at all".
    setMemberTakesCalls: ownerOrOffice
      .input(z.object({ userId: z.string().uuid(), takesCalls: z.boolean() }))
      .output(z.object({ id: z.string().uuid(), takesCalls: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const [updated] = await ctx.tx
          .update(users)
          .set({ takesCalls: input.takesCalls, updatedAt: new Date() })
          .where(and(eq(users.id, asUserId(input.userId)), eq(users.orgId, ctx.principal.orgId)))
          .returning({ id: users.id, takesCalls: users.takesCalls, callbackVerifiedAt: users.callbackVerifiedAt });

        if (!updated) {
          throw new TRPCError({ code: "NOT_FOUND", message: "user not found in this org" });
        }

        // Turning it on for somebody with no VERIFIED number is a no-op the shop would never see:
        // the reader excludes them, so the front desk would silently skip the person the owner just
        // put on call. Refuse instead of accepting a setting that does nothing.
        if (input.takesCalls && !updated.callbackVerifiedAt) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "they need a verified callback number before they can take calls",
          });
        }

        logger.info({ userId: input.userId, takesCalls: input.takesCalls }, "identity.setMemberTakesCalls");
        return { id: updated.id, takesCalls: updated.takesCalls };
      }),

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

    // Set the certification tags for a field-crew member.
    // Deduplicates case-insensitively (first occurrence wins for display casing).
    // Restricted to owner/office — org-scoped update + RLS double-lock.
    setMemberSkillTags: ownerOrOffice
      .input(
        z.object({
          userId: z.string().uuid(),
          skillTags: z.array(z.string().trim().min(1).max(40)).max(10),
        }),
      )
      .output(
        z.object({
          id: z.string().uuid(),
          email: z.string(),
          role: roleEnum,
          name: z.string().nullable(),
          isFieldCrew: z.boolean(),
          skillTags: z.array(z.string()),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Normalize-dedupe: keep first occurrence per normCert key, preserve display casing.
        const seen = new Set<string>();
        const deduped = input.skillTags.filter((tag) => {
          const key = normCert(tag);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        const [updated] = await ctx.tx
          .update(users)
          .set({ skillTags: deduped, updatedAt: new Date() })
          .where(and(eq(users.id, asUserId(input.userId)), eq(users.orgId, ctx.principal.orgId)))
          .returning({ id: users.id, email: users.email, role: users.role, name: users.name, isFieldCrew: users.isFieldCrew, skillTags: users.skillTags });

        if (!updated) {
          throw new TRPCError({ code: "NOT_FOUND", message: "user not found in this org" });
        }

        logger.info(
          { targetUserId: input.userId, tagCount: deduped.length, actorUserId: ctx.principal.userId },
          "identity.setMemberSkillTags",
        );

        return {
          id: updated.id,
          email: updated.email,
          role: roleEnum.parse(updated.role),
          name: updated.name ?? null,
          isFieldCrew: updated.isFieldCrew,
          skillTags: updated.skillTags ?? [],
        };
      }),
  });
