import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import { DrizzleRegistrationRepository } from "../infra/drizzle-registration-repository";
import { GetA2pStatusUseCase } from "./get-status";
import type { A2pTenantRunner } from "./begin-registration";

/**
 * Non-throwing "may this org send SMS right now" read — the raw `GetA2pStatusUseCase.canText`
 * projection, no side effects either way. This is the SAME check `assertSmsA2pActive` (notification
 * router) builds inline, factored out so both an INTERACTIVE caller (which wraps this in a throw,
 * surfacing PRECONDITION_FAILED to a human) and a BACKGROUND/fire-and-forget caller (which uses the
 * boolean directly to skip-not-throw, e.g. the voice front desk's booking-confirmation SMS) share
 * one definition of "active." A missing registration row (org never started) reads as inactive,
 * same as every other gated path.
 */
export const isSmsA2pActive = async (tx: TenantTx, orgId: OrgId): Promise<boolean> => {
  const repo = new DrizzleRegistrationRepository(tx, orgId);
  const run: A2pTenantRunner = (fn) => fn(repo);
  const status = await new GetA2pStatusUseCase(run).exec(orgId);
  return status.canText;
};
