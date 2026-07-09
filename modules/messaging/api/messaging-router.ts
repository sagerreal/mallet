import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice } from "@/trpc/init";
import { loadConfig } from "@mallet/shared/config";
import { orgs, leads } from "@mallet/shared/db/schema";
import { asLeadId } from "@mallet/shared/types";
import { DrizzleMessageRepository } from "../infra/drizzle-message-repository";
import { SendMessageUseCase } from "../app/send-message";
import { ListThreadUseCase } from "../app/list-thread";
import { messageDTO, toMessageDTO } from "./message-dto";

const sendInput = z.object({
  leadId: z.string().uuid(),
  body: z.string().min(1).max(1600),
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

        // Resolve the lead's phone — required to send.
        const leadRows = await tx
          .select({ phoneE164: leads.phoneE164 })
          .from(leads)
          .where(eq(leads.id, input.leadId))
          .limit(1);
        const leadPhone = leadRows[0]?.phoneE164 ?? null;

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
          },
          ctx.deps.ids,
        );
        const result = await useCase.exec({
          orgId,
          orgTwilioNumber,
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
  });
