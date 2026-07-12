import { withTenant } from "@mallet/shared/db/tx";
import { asEstimateId, asLeadId, systemClock } from "@mallet/shared/types";
import { uuidGenerator } from "@mallet/shared/ports";
import { OutboxEventBus } from "@mallet/shared/outbox";
import { DrizzleEstimateRepository } from "../infra/drizzle-estimate-repository";
import { DrizzlePublicEstimateReader } from "../infra/drizzle-public-estimate-reader";
import { AcceptEstimateUseCase } from "./accept-estimate";
import type { AcceptLineInput } from "./accept-estimate";
import { DeclineEstimateUseCase } from "./decline-estimate";
import { RequestEstimateChangeUseCase } from "./request-estimate-change";
import { buildAcceptLinesFromSelection } from "./select-optional-lines";
import { classifyAcceptValidationFailure } from "./public-accept-policy";
import type { AcceptPublicQuoteResult } from "./public-accept-policy";
import type { PublicQuoteView } from "../infra/drizzle-public-estimate-reader";
import type { Estimate } from "../domain/estimate";
import { DrizzleJobRepository, DrizzleEstimateReader, CreateJobFromEstimateUseCase } from "@mallet/jobs";
import { DrizzleTaskRepository, CreateTaskUseCase } from "@mallet/tasks";
import { logger } from "@mallet/shared/observability";

// Result type for requestChangePublicQuote — disambiguates cooldown rejection from the
// idempotent "not sent" path so the route can return the correct HTTP status.
export type RequestChangeResult =
  | { kind: "ok"; estimate: Estimate }
  | { kind: "cooldown" }
  | { kind: "not_sent"; estimate: Estimate | null }
  | { kind: "not_found" };

// Result type + validation-failure classification for acceptPublicQuote live in
// public-accept-policy.ts (kept import-light for unit tests); re-exported here so
// callers keep a single import surface.
export type { AcceptPublicQuoteResult } from "./public-accept-policy";

// Re-export so callers only need to import from this module.
export type { PublicQuoteView };

// Fetch the public quote view for a given token. Stamps first_viewed_at on first load (idempotent).
// Returns null if the token does not match any active (non-deleted) estimate.
// The token is the ONLY input — no org_id or estimate_id is accepted from callers.
export async function getPublicQuote(token: string): Promise<PublicQuoteView | null> {
  const reader = new DrizzlePublicEstimateReader();
  return reader.findByToken(token);
}

// Accept an estimate via its public token, optionally committing the customer's selection of
// OPTIONAL add-on lines. Idempotent: an already-accepted estimate returns its current state
// without error. A token that does not match → not_found.
// Reuses AcceptEstimateUseCase inside withTenant — no parallel accept path.
//
// SECURITY: the selection is an ID SUBSET only. Committed lines are built from the STORED
// estimate's lines (buildAcceptLinesFromSelection) — an unauthenticated token holder can
// toggle add-ons but can never author line content or rewrite prices.
export async function acceptPublicQuote(
  token: string,
  selectedOptionalLineIds?: readonly string[],
): Promise<AcceptPublicQuoteResult> {
  const reader = new DrizzlePublicEstimateReader();
  const resolved = await reader.resolveOrgByToken(token);
  if (!resolved) return { kind: "not_found" };

  const { estimateId, orgId } = resolved;

  return withTenant(orgId, async (tx) => {
    // Construct the per-tx outbox bus INSIDE withTenant so emitted events land in the outbox
    // atomically with the state change — mirrors the tRPC orgTx middleware (trpc/init.ts).
    const bus = new OutboxEventBus(tx, orgId);
    const repo = new DrizzleEstimateRepository(tx, orgId);

    // Load the stored estimate FIRST: the selection is validated against (and the committed
    // lines built from) stored data only — never from client-authored content.
    const stored = await repo.findById(asEstimateId(estimateId));
    if (!stored) return { kind: "not_found" };

    // Only validate the selection while the quote is still open. Accept regenerates line ids,
    // so validating a retried selection against a terminal estimate would wrongly reject the
    // idempotent re-accept path.
    let lines: readonly AcceptLineInput[] | undefined;
    if (stored.props.status === "sent") {
      const selection = buildAcceptLinesFromSelection(stored, selectedOptionalLineIds);
      if (selection.kind === "invalid") {
        logger.warn(
          { estimateId, orgId },
          "public-quote.accept: selection did not match stored optional lines",
        );
        return { kind: "invalid_selection" };
      }
      if (selection.kind === "lines") lines = selection.lines;
    }

    const useCase = new AcceptEstimateUseCase(repo, bus, systemClock, uuidGenerator);
    const result = await useCase.exec({
      estimateId: asEstimateId(estimateId),
      ...(lines ? { lines } : {}),
    });

    if (!result.ok) {
      // Validation failure — branch on the re-fetched status: TERMINAL (accepted/
      // declined) is the idempotent double-tap → ok with current state; a
      // non-terminal estimate (still draft) was NOT accepted → not_ready, so the
      // route can answer honestly instead of faking an approval.
      if (result.error.kind === "validation") {
        const current = await repo.findById(asEstimateId(estimateId));
        const classified = classifyAcceptValidationFailure(current);
        if (classified.kind === "not_ready") {
          logger.warn(
            { estimateId, orgId, status: current?.props.status },
            "public-quote.accept: estimate not in an acceptable state",
          );
        }
        return classified;
      }
      // Not found inside the tenant tx — shouldn't happen since ownerDb resolved it, but guard.
      return { kind: "not_found" };
    }

    // After the estimate is accepted, create its job in a savepoint so a failure does NOT
    // roll back the accepted estimate. CreateJobFromEstimateUseCase is idempotent (partial
    // unique index on source_estimate_id + ON CONFLICT DO NOTHING), so re-accepts are safe.
    try {
      await tx.transaction(async (sp) => {
        const jobRepo = new DrizzleJobRepository(sp, orgId);
        const estimateReader = new DrizzleEstimateReader(sp, orgId);
        const createJob = new CreateJobFromEstimateUseCase(jobRepo, estimateReader, bus, systemClock, uuidGenerator);
        const jobResult = await createJob.exec({ orgId, estimateId: asEstimateId(estimateId) });
        if (!jobResult.ok) {
          logger.error({ err: jobResult.error, estimateId, orgId }, "public-quote.accept: job creation returned error (non-fatal)");
        }
      });
    } catch (err) {
      logger.error({ err, estimateId, orgId }, "public-quote.accept: job creation failed (non-fatal)");
    }

    return { kind: "ok", estimate: result.value };
  });
}

// Request a change on a sent quote via its public token. The estimate stays "sent" — the office
// receives a task on the lead. Returns a RequestChangeResult discriminated union so the route can
// distinguish a cooldown rejection (→ 429) from an idempotent non-sent path (→ 200).
export async function requestChangePublicQuote(
  token: string,
  message: string,
): Promise<RequestChangeResult> {
  const reader = new DrizzlePublicEstimateReader();
  const resolved = await reader.resolveOrgByToken(token);
  if (!resolved) return { kind: "not_found" };

  const { estimateId, orgId } = resolved;

  return withTenant(orgId, async (tx) => {
    const bus = new OutboxEventBus(tx, orgId);
    const repo = new DrizzleEstimateRepository(tx, orgId);
    const useCase = new RequestEstimateChangeUseCase(repo, bus, systemClock);

    const result = await useCase.exec({
      estimateId: asEstimateId(estimateId),
      message,
    });

    if (!result.ok) {
      // Cooldown: propagate as a distinct result kind so the route can return 429.
      if (result.error.kind === "validation" && result.error.field === "cooldown") {
        return { kind: "cooldown" };
      }
      // Idempotent path: estimate is in a non-sent state (wrong status, empty message, etc.)
      // → return current state without error.
      if (result.error.kind === "validation") {
        const current = await repo.findById(asEstimateId(estimateId));
        return { kind: "not_sent", estimate: current };
      }
      return { kind: "not_found" };
    }

    // Create a task on the lead so the office is notified. Wrapped in a savepoint so a task
    // creation failure does NOT roll back the recorded change request. Non-fatal.
    try {
      await tx.transaction(async (sp) => {
        const taskRepo = new DrizzleTaskRepository(sp, orgId);
        const createTask = new CreateTaskUseCase(taskRepo, systemClock, uuidGenerator);
        const est = result.value;
        const trimmedMsg = est.props.changeRequest ?? message.trim();
        const taskText = `Quote ${est.props.num}: change requested — "${trimmedMsg.length > 80 ? trimmedMsg.slice(0, 80) + "…" : trimmedMsg}"`;
        const taskResult = await createTask.exec(
          {
            leadId: asLeadId(est.props.leadId),
            text: taskText,
            dueDate: null,
          },
          orgId,
        );
        if (!taskResult.ok) {
          logger.error(
            { err: taskResult.error, estimateId, orgId },
            "public-quote.request_change: task creation returned error (non-fatal)",
          );
        }
      });
    } catch (taskErr) {
      logger.error(
        { err: taskErr, estimateId, orgId },
        "public-quote.request_change: task creation failed (non-fatal)",
      );
    }

    return { kind: "ok", estimate: result.value };
  });
}

// Decline an estimate via its public token. Idempotent: an already-terminal estimate returns its
// current state without error. A token that does not match → null (not-found).
export async function declinePublicQuote(
  token: string,
  reason?: string,
): Promise<Estimate | null> {
  const reader = new DrizzlePublicEstimateReader();
  const resolved = await reader.resolveOrgByToken(token);
  if (!resolved) return null;

  const { estimateId, orgId } = resolved;
  const declineReason = (reason ?? "").trim() || "Declined by customer";

  return withTenant(orgId, async (tx) => {
    const bus = new OutboxEventBus(tx, orgId);
    const repo = new DrizzleEstimateRepository(tx, orgId);
    const useCase = new DeclineEstimateUseCase(repo, bus, systemClock);

    const result = await useCase.exec({
      estimateId: asEstimateId(estimateId),
      reason: declineReason,
    });

    if (!result.ok) {
      // Idempotent path: already in a terminal state.
      if (result.error.kind === "validation") {
        return repo.findById(asEstimateId(estimateId));
      }
      return null;
    }

    return result.value;
  });
}
