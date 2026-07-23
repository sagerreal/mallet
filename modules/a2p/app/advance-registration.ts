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
 * customer profile, brand, and campaign. Unlike `BeginA2pRegistrationUseCase` — which persists
 * each durable external SID in its OWN committed transaction because a mid-sequence failure must
 * never orphan a SID Twilio already returned — this use case makes exactly ONE external call
 * (`fetchStatus`, a read) per invocation, so read → decide → transition → save runs inside a
 * single committed tx: there is no earlier external side effect a failure here could orphan.
 *
 * Called by both the async status webhook (Task 12 — one org, one change at a time) and a
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
    return this.run(async (repo) => {
      const reg = await repo.get(cmd.orgId);
      if (!reg) return err(notFound("a2p registration not found"));

      const fetched = await this.gateway.fetchStatus({
        profileSid: reg.props.secondaryProfileSid,
        brandSid: reg.props.brandSid,
        campaignSid: reg.props.campaignSid,
        messagingServiceSid: reg.props.messagingServiceSid,
      });
      if (!fetched.ok) return err(fetched.error);

      const { profile, brand, campaign } = fetched.value;

      const reason = rejectionReason({ profile, brand, campaign });
      if (reason) {
        const failed = reg.markFailed(reason);
        await repo.save(failed);
        return ok({ status: failed.props.status });
      }

      const allApproved = profile === "approved" && brand === "approved" && campaign === "approved";
      if (allApproved && reg.props.phoneNumberSid) {
        const active = reg.markActive();
        await repo.save(active);
        return ok({ status: active.props.status });
      }

      // Still pending (or approved but the number hasn't attached yet) — nothing to persist.
      return ok({ status: reg.props.status });
    });
  }
}
