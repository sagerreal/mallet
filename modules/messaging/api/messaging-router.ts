import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice } from "@/trpc/init";
import { loadConfig } from "@mallet/shared/config";
import { orgs, leads, a2pRegistrations } from "@mallet/shared/db/schema";
import { asLeadId, Phone } from "@mallet/shared/types";
import { DrizzleMessageRepository } from "../infra/drizzle-message-repository";
import { SendMessageUseCase } from "../app/send-message";
import { ListThreadUseCase } from "../app/list-thread";
import { ListConversationsUseCase } from "../app/list-conversations";
import { messageDTO, toMessageDTO } from "./message-dto";
import type { ConversationRow } from "../domain/message-repository";

// Wire DTO for the conversations-list endpoint. One entry per lead thread, sorted newest-first.
const conversationDTO = z.object({
  leadId: z.string().uuid(),
  leadName: z.string(),
  // null = no number on file (the inbox disables Text-dependent controls on it).
  phone: z.string().nullable(),
  lastBody: z.string(),
  lastDirection: z.enum(["inbound", "outbound"]),
  lastAt: z.string(), // ISO 8601
  unread: z.boolean(),
});

export type ConversationDTO = z.infer<typeof conversationDTO>;

const toConversationDTO = (row: ConversationRow): ConversationDTO => ({
  leadId: row.leadId,
  leadName: row.leadName,
  phone: row.phone,
  lastBody: row.lastBody,
  lastDirection: row.lastDirection,
  lastAt: row.lastAt.toISOString(),
  unread: row.unread,
});

const sendInput = z.object({
  leadId: z.string().uuid(),
  body: z.string().min(1).max(1600),
  // Optional office-chosen destination override (e.g. the estimate-modal send panel's
  // editable number). Validated server-side via Phone.parse; falls back to the lead's
  // on-file phone when absent.
  to: z.string().min(7).max(25).optional(),
});

const listByLeadInput = z.object({
  leadId: z.string().uuid(),
  limit: z.number().int().positive().max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

// Layer 5: thin transport. Parse/normalize input, construct the org-scoped use-case from the
// request's tx + ports, delegate, map the result. No business logic lives here.
export const createMessagingRouter = () =>
  router({
    // Send an outbound SMS to a lead. Resolves the org's Twilio number and the lead's phone
    // within the tenant transaction (RLS enforces org scoping). Returns the recorded message.
    send: ownerOrOffice
      .input(sendInput)
      .output(messageDTO)
      .mutation(async ({ ctx, input }) => {
        const orgId = ctx.principal.orgId;
        const tx = ctx.tx;

        // Resolve the org's outbound Twilio number (null if not provisioned yet).
        const orgRows = await tx
          .select({ twilioNumber: orgs.twilioNumber })
          .from(orgs)
          .where(eq(orgs.id, orgId))
          .limit(1);
        const orgTwilioNumber = orgRows[0]?.twilioNumber ?? null;

        if (!orgTwilioNumber) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "no business number provisioned for texting yet",
          });
        }

        // Gate outbound SMS on the org's 10DLC campaign being active (mirrors the no-number
        // precondition above — same style, same fail-fast-before-any-send-work shape). No row
        // yet (new org, registration not started) reads as inactive, same as GetA2pStatusUseCase.
        const a2pRows = await tx
          .select({
            status: a2pRegistrations.status,
            // Read alongside the status: it is what the campaign actually attaches to.
            messagingServiceSid: a2pRegistrations.messagingServiceSid,
          })
          .from(a2pRegistrations)
          .where(eq(a2pRegistrations.orgId, orgId))
          .limit(1);
        const a2pActive = a2pRows[0]?.status === "active";

        if (!a2pActive) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "texting isn't approved for this org yet — finish 10DLC registration",
          });
        }

        // Destination: an explicit office-chosen override wins (validated here — untrusted
        // input goes through Phone.parse); otherwise fall back to the lead's on-file phone.
        let leadPhone: string | null = null;
        if (input.to) {
          const parsed = Phone.parse(input.to);
          if (!parsed.ok) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "invalid phone number" });
          }
          leadPhone = parsed.value;
        } else {
          const leadRows = await tx
            .select({ phoneE164: leads.phoneE164 })
            .from(leads)
            .where(eq(leads.id, input.leadId))
            .limit(1);
          leadPhone = leadRows[0]?.phoneE164 ?? null;
        }

        if (!leadPhone) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "lead has no phone number on file",
          });
        }

        const config = loadConfig();
        if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "SMS is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing)",
          });
        }

        const repo = new DrizzleMessageRepository(tx, orgId);
        const useCase = new SendMessageUseCase(
          repo,
          {
            accountSid: config.TWILIO_ACCOUNT_SID,
            authToken: config.TWILIO_AUTH_TOKEN,
            clock: ctx.deps.clock,
            // So Twilio is told where to report what the carrier did. Without it every text stays
            // "sent" forever, whether it landed or was dropped.
            publicAppUrl: config.PUBLIC_APP_URL,
          },
          ctx.deps.ids,
        );
        const result = await useCase.exec({
          orgId,
          orgTwilioNumber,
          a2pActive,
          messagingServiceSid: a2pRows[0]?.messagingServiceSid ?? null,
          leadId: asLeadId(input.leadId),
          leadPhone,
          body: input.body,
        });

        if (!result.ok) {
          throw new TRPCError({ code: "BAD_GATEWAY", message: result.error.message });
        }

        return toMessageDTO(result.value);
      }),

    // List the SMS thread for a lead, chronological (oldest-first).
    listByLead: ownerOrOffice
      .input(listByLeadInput)
      .output(z.array(messageDTO))
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleMessageRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ListThreadUseCase(repo);
        const thread = await useCase.exec({
          leadId: asLeadId(input.leadId),
          limit: input.limit,
          offset: input.offset,
        });
        return thread.map(toMessageDTO);
      }),

    // List all customer conversation threads for the org, newest-first.
    // One entry per lead (the lead's most-recent non-deleted message). Owner/office only;
    // a future pass will add tech scoping by passing filter.leadId into the use-case.
    listConversations: ownerOrOffice
      .output(z.array(conversationDTO))
      .query(async ({ ctx }) => {
        const repo = new DrizzleMessageRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ListConversationsUseCase(repo);
        const rows = await useCase.exec({});
        return rows.map(toConversationDTO);
      }),
  });
