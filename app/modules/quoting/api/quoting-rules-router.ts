import { z } from "zod";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asQuotingRuleId } from "@mallet/shared/types";
import { RULE_MAX_LENGTH, JOB_TAG_MAX_LENGTH, type QuotingRule } from "../domain/quoting-rule";
import { DrizzleQuotingRuleRepository } from "../infra/drizzle-quoting-rule-repository";
import { CreateQuotingRuleUseCase } from "../app/create-quoting-rule";
import { ConfirmQuotingRuleUseCase } from "../app/confirm-quoting-rule";
import { DismissQuotingRuleUseCase } from "../app/dismiss-quoting-rule";

const ruleDTO = z.object({
  id: z.string().uuid(),
  rule: z.string(),
  serviceId: z.string().uuid().nullable(),
  jobTag: z.string().nullable(),
  status: z.enum(["proposed", "confirmed"]),
  source: z.enum(["manual", "refine", "edit_delta"]),
  timesConfirmed: z.number().int(),
  createdAt: z.string(),
});

const createInput = z.object({
  rule: z.string().trim().min(1).max(RULE_MAX_LENGTH),
  serviceId: z.string().uuid().nullish(),
  jobTag: z.string().trim().max(JOB_TAG_MAX_LENGTH).nullish(),
  source: z.enum(["manual", "refine"]).optional(),
  sourceEstimateId: z.string().uuid().nullish(),
});

const idInput = z.object({ ruleId: z.string().uuid() });

const toRuleDTO = (rule: QuotingRule) => {
  const p = rule.props;
  return {
    id: p.id,
    rule: p.rule,
    serviceId: p.serviceId,
    jobTag: p.jobTag,
    status: p.status,
    source: p.source,
    timesConfirmed: p.timesConfirmed,
    createdAt: p.createdAt.toISOString(),
  };
};

// v1.quoting.rules — the estimator's learned-rule surface. Layer 5: thin
// transport over the rule use-cases; org + role always from the principal.
export const createQuotingRulesRouter = () =>
  router({
    // Both halves of the memory surface in one read: live rules (what prompts
    // consume) + the review queue (edit-delta ≥2 recurrences, human proposals).
    list: ownerOrOffice
      .output(z.object({ confirmed: z.array(ruleDTO), proposed: z.array(ruleDTO) }))
      .query(async ({ ctx }) => {
        const repo = new DrizzleQuotingRuleRepository(ctx.tx, ctx.principal.orgId);
        const [confirmed, proposed] = await Promise.all([repo.listConfirmed(), repo.listProposed()]);
        return { confirmed: confirmed.map(toRuleDTO), proposed: proposed.map(toRuleDTO) };
      }),

    // Owner/office rules go live immediately UNLESS they overlap an existing
    // confirmed rule (potential contradiction → review queue). Role from the
    // verified principal, never from input.
    create: ownerOrOffice
      .input(createInput)
      .output(ruleDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleQuotingRuleRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CreateQuotingRuleUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec({
          orgId: ctx.principal.orgId,
          authorUserId: ctx.principal.userId,
          role: ctx.principal.role,
          rule: input.rule,
          serviceId: input.serviceId ?? null,
          jobTag: input.jobTag ?? null,
          source: input.source ?? "manual",
          sourceEstimateId: input.sourceEstimateId ?? null,
        });
        return toRuleDTO(orThrow(result));
      }),

    // Promote a proposal; overlapping confirmed rules are superseded (kept as
    // history, taken out of prompts).
    confirm: ownerOrOffice
      .input(idInput)
      .output(ruleDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleQuotingRuleRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ConfirmQuotingRuleUseCase(repo, ctx.deps.clock);
        return toRuleDTO(orThrow(await useCase.exec({ ruleId: asQuotingRuleId(input.ruleId) })));
      }),

    // Dismiss a proposal / forget a confirmed rule — same invalidation.
    dismiss: ownerOrOffice
      .input(idInput)
      .output(z.object({ ok: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleQuotingRuleRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new DismissQuotingRuleUseCase(repo, ctx.deps.clock);
        orThrow(await useCase.exec({ ruleId: asQuotingRuleId(input.ruleId) }));
        return { ok: true };
      }),
  });
