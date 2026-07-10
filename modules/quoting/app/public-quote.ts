import { withTenant } from "@mallet/shared/db/tx";
import { asEstimateId, systemClock } from "@mallet/shared/types";
import { uuidGenerator } from "@mallet/shared/ports";
import { OutboxEventBus } from "@mallet/shared/outbox";
import { DrizzleEstimateRepository } from "../infra/drizzle-estimate-repository";
import { DrizzlePublicEstimateReader } from "../infra/drizzle-public-estimate-reader";
import { AcceptEstimateUseCase } from "./accept-estimate";
import { DeclineEstimateUseCase } from "./decline-estimate";
import type { PublicQuoteView } from "../infra/drizzle-public-estimate-reader";
import type { Estimate } from "../domain/estimate";

// Re-export so callers only need to import from this module.
export type { PublicQuoteView };

// Fetch the public quote view for a given token. Stamps first_viewed_at on first load (idempotent).
// Returns null if the token does not match any active (non-deleted) estimate.
// The token is the ONLY input — no org_id or estimate_id is accepted from callers.
export async function getPublicQuote(token: string): Promise<PublicQuoteView | null> {
  const reader = new DrizzlePublicEstimateReader();
  return reader.findByToken(token);
}

// Accept an estimate via its public token. Idempotent: an already-accepted estimate returns its
// current state without error. A token that does not match → null (not-found).
// Reuses AcceptEstimateUseCase inside withTenant — no parallel accept path.
export async function acceptPublicQuote(token: string): Promise<Estimate | null> {
  const reader = new DrizzlePublicEstimateReader();
  const resolved = await reader.resolveOrgByToken(token);
  if (!resolved) return null;

  const { estimateId, orgId } = resolved;

  return withTenant(orgId, async (tx) => {
    // Construct the per-tx outbox bus INSIDE withTenant so emitted events land in the outbox
    // atomically with the state change — mirrors the tRPC orgTx middleware (trpc/init.ts).
    const bus = new OutboxEventBus(tx, orgId);
    const repo = new DrizzleEstimateRepository(tx, orgId);
    const useCase = new AcceptEstimateUseCase(repo, bus, systemClock, uuidGenerator);

    const result = await useCase.exec({ estimateId: asEstimateId(estimateId) });

    if (!result.ok) {
      // Idempotent path: the estimate is in a terminal state (accepted or declined) — the domain
      // model's canAccept() returns false, producing a validation error. Load and return current.
      if (result.error.kind === "validation") {
        return repo.findById(asEstimateId(estimateId));
      }
      // Not found inside the tenant tx — shouldn't happen since ownerDb resolved it, but guard.
      return null;
    }

    return result.value;
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
