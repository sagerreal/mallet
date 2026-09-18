import { ok, err, notFound, type Result, type AppError, type Clock } from "@mallet/shared/types";
import type { A2pStatus } from "../domain/registration";
import type { A2pGateway, RemoteStatus } from "../domain/a2p-gateway";
import type { A2pTenantRunner } from "./begin-registration";

// Which of the three async-reviewed resources was rejected, in priority order. A single string
// reason is stored on `failureReason` — if more than one is rejected the earliest (in this order)
// wins, but all rejections encountered are still named in the message.
function rejectionReason(statuses: { profile: RemoteStatus; brand: RemoteStatus; campaign: RemoteStatus }): string | null {
  const rejected: string[] = [];
  if (statuses.profile === "rejected") rejected.push("secondary customer profile");
  if (statuses.brand === "rejected") rejected.push("brand registration");
  if (statuses.campaign === "rejected") rejected.push("campaign registration");
  if (rejected.length === 0) return null;
  return `Twilio rejected: ${rejected.join(", ")}`;
}

/**
 * Advances a registration's status by polling Twilio's async approval outcome for the secondary
 * customer profile, brand, and campaign. `fetchStatus` is a read against Twilio, but it is still a
 * network round-trip — and this use case is called by a scheduled poll over MANY orgs (Task 12),
 * so a naive single-tx implementation would hold one Postgres connection per org blocked on that
 * round-trip, exhausting the pool under concurrency. Instead, mirroring the outside-any-tx external
 * calls in `BeginA2pRegistrationUseCase` / `BeginConnectOnboardingUseCase`: read tx (load the SIDs
 * to check) → external call with NO tx open → write tx (re-read for a concurrent-write recheck,
 * apply the decision, save only if the status actually changed).
 *
 * Called by both the async status webhook (Task 12 — one org, one change at a time) and the
 * scheduled poll (many orgs) — `exec()` takes only an `orgId` and derives the decision entirely
 * from the persisted registration + the gateway's current view, so repeated calls are idempotent:
 * "still pending" leaves the registration untouched rather than re-saving a no-op.
 */
export class AdvanceA2pRegistrationUseCase {
  constructor(
    private readonly gateway: A2pGateway,
    private readonly run: A2pTenantRunner,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: { orgId: string }): Promise<Result<{ status: A2pStatus }, AppError>> {
    // 1. Read tx: load the registration and the SIDs to check. No tx stays open across the
    //    external call below.
    const sids = await this.run(async (repo) => {
      const reg = await repo.get(cmd.orgId);
      if (!reg) return null;
      return {
        profileSid: reg.props.secondaryProfileSid,
        brandSid: reg.props.brandSid,
        campaignSid: reg.props.campaignSid,
        messagingServiceSid: reg.props.messagingServiceSid,
      };
    });
    if (!sids) return err(notFound("a2p registration not found"));

    // 2. External call, no tx open — this is the network round-trip a scheduled poll must not
    //    hold a DB connection through.
    const fetched = await this.gateway.fetchStatus(sids);
    if (!fetched.ok) return err(fetched.error);

    const { profile, brand, campaign } = fetched.value;

    // 3. Write tx: re-read for a concurrent-write recheck (mirrors Begin's re-check before each
    //    save), apply the decision, and save only if the status actually changed.
    return this.run(async (repo) => {
      const reg = await repo.get(cmd.orgId);
      if (!reg) return err(notFound("a2p registration not found"));

      const reason = rejectionReason({ profile, brand, campaign });
      if (reason) {
        const failed = reg.markFailed(reason);
        if (failed.props.status !== reg.props.status) await repo.save(failed);
        return ok({ status: failed.props.status });
      }

      const allApproved = profile === "approved" && brand === "approved" && campaign === "approved";
      if (allApproved && reg.props.phoneNumberSid) {
        const active = reg.markActive();
        if (active.props.status !== reg.props.status) await repo.save(active);
        return ok({ status: active.props.status });
      }

      // Still pending (or approved but the number hasn't attached yet) — nothing to persist.
      return ok({ status: reg.props.status });
    });
  }
}
