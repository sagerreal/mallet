import { ok, err, type Result, type AppError, type Clock } from "@mallet/shared/types";
import { A2pRegistration, brandKind, type A2pStatus, type BusinessInfo } from "../domain/registration";
import type { RegistrationRepository } from "../domain/registration-repository";
import type { A2pGateway } from "../domain/a2p-gateway";
import { buildConsentDescription, buildOptInMessage, buildSampleMessages } from "./generate-consent";

/**
 * Runs a unit of A2P registration work inside its OWN committed org-scoped transaction and
 * returns the result. Each call is an independent commit — the caller (a NoTx tRPC procedure)
 * supplies a runner that opens a fresh `withTenant` tx and builds an org-bound repository. This
 * lets the registration flow durably persist each external SID BEFORE the next fallible external
 * call, so a mid-sequence failure can never roll back a SID already returned by Twilio (which
 * would orphan that resource and force a duplicate on retry).
 */
export type A2pTenantRunner = <T>(fn: (repo: RegistrationRepository) => Promise<T>) => Promise<T>;

const emptyRegistration = (orgId: string): A2pRegistration => {
  const created = A2pRegistration.create({
    orgId,
    status: "not_started",
    secondaryProfileSid: null,
    brandSid: null,
    messagingServiceSid: null,
    campaignSid: null,
    phoneNumberSid: null,
    businessInfo: null,
    otpVerified: false,
    failureReason: null,
  });
  // orgId is always non-empty here (validated by the caller boundary); this can't fail in practice.
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
};

/**
 * Runs the full external A2P 10DLC registration sequence: secondary profile → brand → messaging
 * service → campaign → number attach. Ordering is deliberate and mirrors
 * `BeginConnectOnboardingUseCase`: each durable external SID is persisted in its OWN committed
 * transaction immediately after the external call returns, BEFORE the next fallible external call
 * is attempted. On any external failure, the registration is marked `failed` (with the reason)
 * and persisted — the SIDs already saved remain, so a re-run resumes from the first missing step
 * rather than orphaning already-created Twilio resources.
 */
export class BeginA2pRegistrationUseCase {
  constructor(
    private readonly gateway: A2pGateway,
    private readonly run: A2pTenantRunner,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: {
    orgId: string;
    info: BusinessInfo;
    phoneNumberSid: string;
  }): Promise<Result<{ status: A2pStatus }, AppError>> {
    // 1. Seed business info in its own committed tx — but ONLY for a brand-new registration
    //    (none persisted yet, or still "not_started"). `withBusinessInfo` always sets
    //    status="collecting" as a side effect (see domain/registration.ts), so re-invoking
    //    `exec()` on an already-advanced registration must resume from its current state
    //    instead of regressing status back to "collecting" on every call.
    await this.run(async (repo) => {
      const current = await repo.get(cmd.orgId);
      if (!current || current.props.status === "not_started") {
        await repo.save((current ?? emptyRegistration(cmd.orgId)).withBusinessInfo(cmd.info));
      }
    });

    // 2. Secondary profile: create (external, no tx open) → persist (own committed tx).
    let profileSid = await this.currentSid(cmd.orgId, (r) => r.props.secondaryProfileSid);
    if (!profileSid) {
      const created = await this.gateway.createSecondaryProfile({ orgId: cmd.orgId, info: cmd.info });
      if (!created.ok) return this.fail(cmd.orgId, created.error);
      profileSid = created.value.profileSid;
      await this.persistSid(cmd.orgId, (r) => r.props.secondaryProfileSid, (r) => r.withProfile(profileSid!));
    }

    // 3. Brand: create (external) → persist (own committed tx).
    let brandSid = await this.currentSid(cmd.orgId, (r) => r.props.brandSid);
    if (!brandSid) {
      const created = await this.gateway.registerBrand({ profileSid, kind: brandKind(cmd.info) });
      if (!created.ok) return this.fail(cmd.orgId, created.error);
      brandSid = created.value.brandSid;
      await this.persistSid(cmd.orgId, (r) => r.props.brandSid, (r) => r.withBrand(brandSid!));
    }

    // 4. Messaging service: create (external) → persist (own committed tx).
    let messagingServiceSid = await this.currentSid(cmd.orgId, (r) => r.props.messagingServiceSid);
    if (!messagingServiceSid) {
      const created = await this.gateway.createMessagingService({ orgId: cmd.orgId });
      if (!created.ok) return this.fail(cmd.orgId, created.error);
      messagingServiceSid = created.value.messagingServiceSid;
      await this.persistSid(
        cmd.orgId,
        (r) => r.props.messagingServiceSid,
        (r) => r.withMessagingService(messagingServiceSid!),
      );
    }

    // 5. Campaign: create (external) → persist (own committed tx).
    let campaignSid = await this.currentSid(cmd.orgId, (r) => r.props.campaignSid);
    if (!campaignSid) {
      const created = await this.gateway.registerCampaign({
        messagingServiceSid,
        brandSid,
        content: {
          description: buildConsentDescription(cmd.info),
          messageSamples: buildSampleMessages(cmd.info),
          consentDescription: buildConsentDescription(cmd.info),
          optInMessage: buildOptInMessage(cmd.info),
          usecase: "LOW_VOLUME",
        },
      });
      if (!created.ok) return this.fail(cmd.orgId, created.error);
      campaignSid = created.value.campaignSid;
      await this.persistSid(cmd.orgId, (r) => r.props.campaignSid, (r) => r.withCampaign(campaignSid!));
    }

    // 6. Attach the phone number: external call → persist number SID + number_pending status.
    const numberSid = await this.currentSid(cmd.orgId, (r) => r.props.phoneNumberSid);
    if (!numberSid) {
      const attached = await this.gateway.attachNumber({ messagingServiceSid, phoneNumberSid: cmd.phoneNumberSid });
      if (!attached.ok) return this.fail(cmd.orgId, attached.error);
      await this.persistSid(
        cmd.orgId,
        (r) => r.props.phoneNumberSid,
        (r) => r.withNumber(cmd.phoneNumberSid),
      );
    }

    const final = await this.run(async (repo) => repo.get(cmd.orgId));
    return ok({ status: final?.props.status ?? "number_pending" });
  }

  // Re-reads the registration under a fresh tx and returns the requested SID (concurrent-write
  // recheck — mirrors the Connect ordering's re-check before each save).
  private async currentSid(
    orgId: string,
    select: (r: A2pRegistration) => string | null,
  ): Promise<string | null> {
    return this.run(async (repo) => {
      const current = await repo.get(orgId);
      return current ? select(current) : null;
    });
  }

  // Persists a SID in its own committed tx, re-checking under this tx for a concurrent write that
  // already stored it (adopt rather than overwrite), same as `BeginConnectOnboardingUseCase`.
  private async persistSid(
    orgId: string,
    select: (r: A2pRegistration) => string | null,
    transition: (r: A2pRegistration) => A2pRegistration,
  ): Promise<void> {
    await this.run(async (repo) => {
      const current = (await repo.get(orgId)) ?? emptyRegistration(orgId);
      if (select(current)) return; // a concurrent request already persisted this SID.
      await repo.save(transition(current));
    });
  }

  // Loads the registration under a fresh tx, marks it failed with the originating error's
  // message, and persists it — the SIDs already saved by prior steps are preserved (durable,
  // resumable) — then propagates the SAME error to the caller (mirrors Connect's `err(created.error)`).
  private async fail(orgId: string, error: AppError): Promise<Result<never, AppError>> {
    await this.run(async (repo) => {
      const current = (await repo.get(orgId)) ?? emptyRegistration(orgId);
      await repo.save(current.markFailed(error.message));
    });
    return err(error);
  }
}
