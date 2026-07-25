import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, anyRole } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { DrizzleJobRepository } from "@mallet/jobs";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId, LeadId, UserId } from "@mallet/shared/types";
import { asLeadId, asOutboundCallId } from "@mallet/shared/types";
import type { Principal } from "@mallet/identity";
import { DrizzleOutboundCallRepository } from "../infra/drizzle-outbound-call-repository";
import {
  DrizzleLeadPhoneReader,
  DrizzleOrgLineReader,
  DrizzleAgentNumberStore,
} from "../infra/drizzle-call-directory";
import { PlaceOutboundCallUseCase } from "../app/place-outbound-call";
import { LogCallOutcomeUseCase } from "../app/log-call-outcome";
import { GetOutboundCallUseCase } from "../app/get-outbound-call";
import { SetCallbackNumberUseCase } from "../app/set-callback-number";
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

// Null clears the stored number. The USER is never in the input — it comes from the principal, so
// nobody can rewrite a colleague's mobile and have Mallet ring them instead.
const setCallbackNumberInput = z.object({
  callbackNumber: z.string().max(50).nullable(),
});

const callbackNumberOutput = z.object({ callbackNumber: z.string().nullable() });

/**
 * Assignment is the authorization boundary for a technician — the same rule the field job surface
 * uses (`assertOnJobIfTech`), asked about a CUSTOMER instead of a job: may this person call them?
 *
 * A technician's field shell only ever shows the customers on their own jobs, and the API must not
 * reach further than the UI does. Without this, widening the role would turn the field app into an
 * org-wide dialler: any lead id would place a call on the shop's caller ID and the shop's bill.
 *
 * Owner/office pass — they already hold the whole customer list.
 */
const assertOnAJobForIfTech = async (
  tx: TenantTx,
  orgId: OrgId,
  leadId: LeadId,
  principal: Principal,
): Promise<void> => {
  if (principal.role !== "tech") return;
  // `assignedUserId` is the jobs module's SQL twin of Job.isAssignedTo (job assignee OR the
  // assignee of any active visit) — reused rather than re-expressed, so the two cannot drift.
  const page = await new DrizzleJobRepository(tx, orgId).list(
    { limit: 1, cursor: null },
    { assignedUserId: principal.userId, leadId },
  );
  if (page.items.length === 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "this customer isn't on a job of yours" });
  }
};

/** A technician may only touch the calls they placed themselves. */
const assertOwnCallIfTech = (placedByUserId: UserId, principal: Principal): void => {
  if (principal.role !== "tech") return;
  if (placedByUserId !== principal.userId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "that call is no longer available" });
  }
};

// Layer 5: thin transport. Parse/normalize input, construct the org-scoped use-case from the
// request's tx + ports, delegate, map the result. No business logic lives here.
export const createCallRouter = () =>
  router({
    // Places a two-leg click-to-call: rings the caller's own mobile, then bridges the customer
    // with the org's business line as caller ID.
    place: anyRole
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
        const leadId = asLeadId(input.leadId);
        await assertOnAJobForIfTech(ctx.tx, orgId, leadId, ctx.principal);
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
          leadId,
          placedByUserId: ctx.principal.userId,
          agentNumber: input.agentNumber,
        });
        return toOutboundCallDTO(orThrow(result));
      }),

    // One call, read back. The bar polls this while connecting so "live" means the phone was
    // actually answered rather than "the provider accepted the request".
    get: anyRole
      .input(z.object({ callId: z.string().uuid() }))
      .output(outboundCallDTO)
      .query(async ({ ctx, input }) => {
        const useCase = new GetOutboundCallUseCase(
          new DrizzleOutboundCallRepository(ctx.tx, ctx.principal.orgId),
        );
        const call = orThrow(await useCase.exec(asOutboundCallId(input.callId)));
        assertOwnCallIfTech(call.props.placedByUserId, ctx.principal);
        return toOutboundCallDTO(call);
      }),

    // The durable write for "which phone should Mallet ring". Scoped to the caller themselves.
    setCallbackNumber: anyRole
      .input(setCallbackNumberInput)
      .output(callbackNumberOutput)
      .mutation(async ({ ctx, input }) => {
        const useCase = new SetCallbackNumberUseCase(
          new DrizzleAgentNumberStore(ctx.tx, ctx.principal.orgId),
        );
        const saved = orThrow(
          await useCase.exec({
            userId: ctx.principal.userId,
            callbackNumber: input.callbackNumber,
          }),
        );
        return { callbackNumber: saved };
      }),

    // Writes the disposition after hanging up — the step that makes the row a persisted log.
    logOutcome: anyRole
      .input(logOutcomeInput)
      .output(outboundCallDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleOutboundCallRepository(ctx.tx, ctx.principal.orgId);
        if (ctx.principal.role === "tech") {
          const existing = orThrow(
            await new GetOutboundCallUseCase(repo).exec(asOutboundCallId(input.callId)),
          );
          assertOwnCallIfTech(existing.props.placedByUserId, ctx.principal);
        }
        const useCase = new LogCallOutcomeUseCase(repo, ctx.deps.clock);
        const result = await useCase.exec({
          callId: asOutboundCallId(input.callId),
          outcome: input.outcome,
          notes: input.notes,
        });
        return toOutboundCallDTO(orThrow(result));
      }),
  });
