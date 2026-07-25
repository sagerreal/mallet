import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asLeadId, asOutboundCallId } from "@mallet/shared/types";
import { DrizzleOutboundCallRepository } from "../infra/drizzle-outbound-call-repository";
import {
  DrizzleLeadPhoneReader,
  DrizzleOrgLineReader,
  DrizzleAgentNumberStore,
} from "../infra/drizzle-call-directory";
import { PlaceOutboundCallUseCase } from "../app/place-outbound-call";
import { LogCallOutcomeUseCase } from "../app/log-call-outcome";
import { outboundCallDTO, toOutboundCallDTO } from "./call-dto";

const placeInput = z.object({
  leadId: z.string().uuid(),
  // Optional: supplied the first time (or when it changes) and then remembered on the user.
  agentNumber: z.string().max(50).optional(),
});

const logOutcomeInput = z.object({
  callId: z.string().uuid(),
  outcome: z.string().min(1).max(120),
  notes: z.string().max(10_000),
});

// Layer 5: thin transport. Parse/normalize input, construct the org-scoped use-case from the
// request's tx + ports, delegate, map the result. No business logic lives here.
export const createCallRouter = () =>
  router({
    // Places a two-leg click-to-call: rings the caller's own mobile, then bridges the customer
    // with the org's business line as caller ID.
    place: ownerOrOffice
      .input(placeInput)
      .output(outboundCallDTO)
      .mutation(async ({ ctx, input }) => {
        // Voice is not a channel that may silently degrade: a call the office believes was
        // placed but never happened is exactly the bug this feature exists to fix.
        if (!ctx.deps.callOriginator) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "calling is not configured — set the Twilio voice credentials",
          });
        }
        const orgId = ctx.principal.orgId;
        const useCase = new PlaceOutboundCallUseCase(
          new DrizzleOutboundCallRepository(ctx.tx, orgId),
          ctx.deps.callOriginator,
          new DrizzleLeadPhoneReader(ctx.tx, orgId),
          new DrizzleOrgLineReader(ctx.tx, orgId),
          new DrizzleAgentNumberStore(ctx.tx, orgId),
          ctx.deps.ids,
          ctx.deps.clock,
        );
        const result = await useCase.exec({
          orgId,
          leadId: asLeadId(input.leadId),
          placedByUserId: ctx.principal.userId,
          agentNumber: input.agentNumber,
        });
        return toOutboundCallDTO(orThrow(result));
      }),

    // Writes the disposition after hanging up — the step that makes the row a persisted log.
    logOutcome: ownerOrOffice
      .input(logOutcomeInput)
      .output(outboundCallDTO)
      .mutation(async ({ ctx, input }) => {
        const useCase = new LogCallOutcomeUseCase(
          new DrizzleOutboundCallRepository(ctx.tx, ctx.principal.orgId),
          ctx.deps.clock,
        );
        const result = await useCase.exec({
          callId: asOutboundCallId(input.callId),
          outcome: input.outcome,
          notes: input.notes,
        });
        return toOutboundCallDTO(orThrow(result));
      }),
  });
