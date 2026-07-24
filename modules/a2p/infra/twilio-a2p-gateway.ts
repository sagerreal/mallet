import twilio from "twilio";
import type { Result, ExternalServiceError } from "@mallet/shared/types";
import { ok, err, externalService } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { A2pGateway, CampaignContent, RemoteStatus } from "../domain/a2p-gateway";
import type { BusinessInfo } from "../domain/registration";

// --- Pinned TrustHub/Messaging constants ------------------------------------------------------
// Verified Jul 2026 against the published `twilio` Node SDK v6.0.2 type declarations (the version
// pinned in package.json) and
// https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api. Twilio has
// changed policy SIDs across API generations before — reconfirm against that docs URL before any
// live submission (see the Owen prerequisite in task-6-brief.md: Primary Customer Profile must be
// APPROVED as "ISV Reseller or Partner" first).
const SECONDARY_CUSTOMER_PROFILE_POLICY_SID = "RNdfbf3fae0e1107f8aded0e7cead80bf5";
// Low-throughput, mixed-content use case — matches Mallet's SMB (1-50 emp) service-message volume.
// Confirmed a valid enum member of usAppToPersonUsecase (alongside 2FA, MARKETING, EMERGENCY, …).
const CAMPAIGN_USECASE = "LOW_VOLUME";

// The ~12 Twilio SDK calls the A2P module needs, extracted as an injectable seam so unit tests
// exercise the full TrustHub assembly + error-classification logic without a live Twilio account.
// Each op is a thin wrapper around ONE SDK resource call; ordering/idempotency live in
// TwilioA2pGateway / the BeginA2pRegistrationUseCase (Task 7), not here — see the domain port's
// doc comment in ../domain/a2p-gateway.ts.
export interface A2pOps {
  createCustomerProfile(cmd: {
    email: string;
    friendlyName: string;
    statusCallback: string;
  }): Promise<{ sid: string }>;
  createEndUser(cmd: {
    friendlyName: string;
    type: string;
    attributes: Record<string, unknown>;
  }): Promise<{ sid: string }>;
  createAddress(cmd: {
    customerName: string;
    street: string;
    city: string;
    region: string;
    postalCode: string;
    isoCountry: string;
  }): Promise<{ sid: string }>;
  createSupportingDocument(cmd: {
    friendlyName: string;
    type: string;
    attributes: Record<string, unknown>;
  }): Promise<{ sid: string }>;
  assignEntity(cmd: { profileSid: string; objectSid: string }): Promise<void>;
  evaluateProfile(cmd: { profileSid: string }): Promise<{ status: "compliant" | "noncompliant" }>;
  submitProfile(profileSid: string): Promise<void>;
  createBrand(cmd: {
    customerProfileBundleSid: string;
    a2PProfileBundleSid: string;
    brandType: "STANDARD" | "SOLE_PROPRIETOR";
  }): Promise<{ sid: string }>;
  createMessagingService(cmd: { friendlyName: string }): Promise<{ sid: string }>;
  createCampaign(cmd: {
    messagingServiceSid: string;
    brandRegistrationSid: string;
    content: CampaignContent;
  }): Promise<{ sid: string }>;
  attachNumberToService(cmd: { messagingServiceSid: string; phoneNumberSid: string }): Promise<void>;
  fetchProfileStatus(profileSid: string): Promise<RemoteStatus>;
  fetchBrandStatus(brandSid: string): Promise<RemoteStatus>;
  fetchCampaignStatus(cmd: { messagingServiceSid: string; campaignSid: string }): Promise<RemoteStatus>;
}

const errStatus = (e: unknown): number | undefined =>
  typeof (e as { status?: unknown }).status === "number" ? (e as { status: number }).status : undefined;
const errCode = (e: unknown): number | null =>
  typeof (e as { code?: unknown }).code === "number" ? (e as { code: number }).code : null;

type Client = ReturnType<typeof twilio>;

async function createCustomerProfileOp(
  client: Client,
  cmd: { email: string; friendlyName: string; statusCallback: string },
): Promise<{ sid: string }> {
  const profile = await client.trusthub.v1.customerProfiles.create({
    email: cmd.email,
    friendlyName: cmd.friendlyName,
    policySid: SECONDARY_CUSTOMER_PROFILE_POLICY_SID,
    statusCallback: cmd.statusCallback,
  });
  return { sid: profile.sid };
}

async function createEndUserOp(
  client: Client,
  cmd: { friendlyName: string; type: string; attributes: Record<string, unknown> },
): Promise<{ sid: string }> {
  const endUser = await client.trusthub.v1.endUsers.create(cmd);
  return { sid: endUser.sid };
}

// NOTE: Address is the account-level resource (client.addresses), not under trusthub.v1 — it is
// then referenced by SID from a trusthub supportingDocument (type customer_profile_address).
async function createAddressOp(
  client: Client,
  cmd: { customerName: string; street: string; city: string; region: string; postalCode: string; isoCountry: string },
): Promise<{ sid: string }> {
  const address = await client.addresses.create(cmd);
  return { sid: address.sid };
}

async function createSupportingDocumentOp(
  client: Client,
  cmd: { friendlyName: string; type: string; attributes: Record<string, unknown> },
): Promise<{ sid: string }> {
  const doc = await client.trusthub.v1.supportingDocuments.create(cmd);
  return { sid: doc.sid };
}

async function assignEntityOp(client: Client, cmd: { profileSid: string; objectSid: string }): Promise<void> {
  await client.trusthub.v1
    .customerProfiles(cmd.profileSid)
    .customerProfilesEntityAssignments.create({ objectSid: cmd.objectSid });
}

async function evaluateProfileOp(
  client: Client,
  cmd: { profileSid: string },
): Promise<{ status: "compliant" | "noncompliant" }> {
  const evaluation = await client.trusthub.v1
    .customerProfiles(cmd.profileSid)
    .customerProfilesEvaluations.create({ policySid: SECONDARY_CUSTOMER_PROFILE_POLICY_SID });
  return { status: evaluation.status };
}

// Moves the bundle from draft -> pending-review; Twilio resolves it to twilio-approved /
// twilio-rejected ASYNCHRONOUSLY via the status callback (app/api/webhooks/twilio-a2p, Task 11)
// — this call itself does not block on the review outcome.
async function submitProfileOp(client: Client, profileSid: string): Promise<void> {
  await client.trusthub.v1.customerProfiles(profileSid).update({ status: "pending-review" });
}

async function createBrandOp(
  client: Client,
  cmd: { customerProfileBundleSid: string; a2PProfileBundleSid: string; brandType: "STANDARD" | "SOLE_PROPRIETOR" },
): Promise<{ sid: string }> {
  // TODO(verify vs Twilio SDK): per https://www.twilio.com/docs/messaging/api/brand-registration-resource,
  // a2PProfileBundleSid is the "A2P Messaging Profile Bundle Sid" — Twilio's ISV guide implies
  // this is a SEPARATE TrustHub bundle (a TrustProduct assembled against an A2P Messaging
  // policy), not the secondary Customer Profile bundle itself. The caller currently passes
  // customerProfileBundleSid for both as a placeholder. Confirm against a live account whether a
  // distinct bundle must be created/assigned/evaluated first (mirroring the createSecondaryProfile
  // assembly) before brand registration will succeed for real.
  const brand = await client.messaging.v1.brandRegistrations.create(cmd);
  return { sid: brand.sid };
}

async function createMessagingServiceOp(client: Client, cmd: { friendlyName: string }): Promise<{ sid: string }> {
  const service = await client.messaging.v1.services.create(cmd);
  return { sid: service.sid };
}

async function createCampaignOp(
  client: Client,
  cmd: { messagingServiceSid: string; brandRegistrationSid: string; content: CampaignContent },
): Promise<{ sid: string }> {
  const campaign = await client.messaging.v1.services(cmd.messagingServiceSid).usAppToPerson.create({
    brandRegistrationSid: cmd.brandRegistrationSid,
    description: cmd.content.description,
    messageFlow: cmd.content.consentDescription,
    messageSamples: cmd.content.messageSamples,
    usAppToPersonUsecase: cmd.content.usecase,
    hasEmbeddedLinks: true,
    hasEmbeddedPhone: true,
    optInMessage: cmd.content.optInMessage,
  });
  return { sid: campaign.sid };
}

async function attachNumberToServiceOp(
  client: Client,
  cmd: { messagingServiceSid: string; phoneNumberSid: string },
): Promise<void> {
  await client.messaging.v1
    .services(cmd.messagingServiceSid)
    .phoneNumbers.create({ phoneNumberSid: cmd.phoneNumberSid });
}

async function fetchProfileStatusOp(client: Client, profileSid: string): Promise<RemoteStatus> {
  const profile = await client.trusthub.v1.customerProfiles(profileSid).fetch();
  return mapProfileStatus(profile.status);
}

async function fetchBrandStatusOp(client: Client, brandSid: string): Promise<RemoteStatus> {
  const brand = await client.messaging.v1.brandRegistrations(brandSid).fetch();
  return mapBrandStatus(brand.status);
}

// The real usAppToPerson (campaign) resource is nested under a Messaging Service — Twilio has no
// flat/top-level lookup by campaign SID alone. `A2pGateway.fetchStatus` (../domain/a2p-gateway.ts)
// now carries messagingServiceSid (A2pRegistrationProps already persists it —
// ../domain/registration.ts — and Task 8's AdvanceA2pRegistrationUseCase has it on hand from the
// loaded registration), so this addresses the resource the same way createCampaignOp does:
// client.messaging.v1.services(messagingServiceSid).usAppToPerson(campaignSid).
// TODO(verify vs Twilio SDK): confirmed against the twilio@6.0.2 type declarations
// (UsAppToPersonListInstance is callable as `(sid) => UsAppToPersonContext`, whose `.fetch()`
// resolves a UsAppToPersonInstance with `campaignStatus: string`) — not yet exercised against a
// live account.
async function fetchCampaignStatusOp(
  client: Client,
  cmd: { messagingServiceSid: string; campaignSid: string },
): Promise<RemoteStatus> {
  const campaign = await client.messaging.v1
    .services(cmd.messagingServiceSid)
    .usAppToPerson(cmd.campaignSid)
    .fetch();
  return mapCampaignStatus(campaign.campaignStatus);
}

// Real ops adapter behind the A2pOps seam — the ONLY place that touches the Twilio SDK for A2P.
// Builds each call from the resource paths/params in .superpowers/sdd/twilio-sequence-ref.md,
// cross-checked against the twilio@6.0.2 type declarations where noted. Where the reference plan
// and the real SDK genuinely diverge (see the a2PProfileBundleSid TODO on createBrandOp above),
// the gap is flagged rather than papered over — real-account verification is deferred to Owen.
function buildTwilioA2pOps(client: Client): A2pOps {
  return {
    createCustomerProfile: (cmd) => createCustomerProfileOp(client, cmd),
    createEndUser: (cmd) => createEndUserOp(client, cmd),
    createAddress: (cmd) => createAddressOp(client, cmd),
    createSupportingDocument: (cmd) => createSupportingDocumentOp(client, cmd),
    assignEntity: (cmd) => assignEntityOp(client, cmd),
    evaluateProfile: (cmd) => evaluateProfileOp(client, cmd),
    submitProfile: (profileSid) => submitProfileOp(client, profileSid),
    createBrand: (cmd) => createBrandOp(client, cmd),
    createMessagingService: (cmd) => createMessagingServiceOp(client, cmd),
    createCampaign: (cmd) => createCampaignOp(client, cmd),
    attachNumberToService: (cmd) => attachNumberToServiceOp(client, cmd),
    fetchProfileStatus: (profileSid) => fetchProfileStatusOp(client, profileSid),
    fetchBrandStatus: (brandSid) => fetchBrandStatusOp(client, brandSid),
    fetchCampaignStatus: (cmd) => fetchCampaignStatusOp(client, cmd),
  };
}

// draft / pending-review / in-review -> pending; twilio-approved -> approved;
// twilio-rejected -> rejected. (CustomerProfilesStatus per the twilio@6.0.2 type declarations.)
function mapProfileStatus(status: string): RemoteStatus {
  if (status === "twilio-approved") return "approved";
  if (status === "twilio-rejected") return "rejected";
  if (status === "draft" || status === "pending-review" || status === "in-review") return "pending";
  return "unknown";
}

// PENDING / IN_REVIEW -> pending; APPROVED -> approved; FAILED -> rejected. Terminal
// deletion/suspension states map to "unknown" pending a real-account confirmation of how they
// should surface to the org (TODO(verify vs Twilio SDK): DELETION_PENDING / DELETION_FAILED /
// SUSPENDED behavior post-approval has not been exercised against a live account).
function mapBrandStatus(status: string): RemoteStatus {
  if (status === "APPROVED") return "approved";
  if (status === "FAILED") return "rejected";
  if (status === "PENDING" || status === "IN_REVIEW") return "pending";
  return "unknown";
}

// IN_PROGRESS -> pending; VERIFIED -> approved; FAILED -> rejected. (UsAppToPersonInstance.
// campaignStatus per the twilio@6.0.2 type declarations — its doc comment lists these three as
// "Examples", not an exhaustive enum. TODO(verify vs Twilio SDK): other/terminal campaignStatus
// values (e.g. a suspended state) are unverified against a live account, same caveat as
// mapBrandStatus above.)
function mapCampaignStatus(status: string): RemoteStatus {
  if (status === "VERIFIED") return "approved";
  if (status === "FAILED") return "rejected";
  if (status === "IN_PROGRESS") return "pending";
  return "unknown";
}

// Binds the A2pGateway port to Twilio's TrustHub + Messaging surface via the injectable A2pOps
// seam (unit-tested with a fake — no live account required). Each method wraps its op(s) in the
// same try/catch classification as TwilioSmsSender: a 4xx is a deterministic per-request failure
// (bad input — retrying the identical request won't help) so retryable:false; a 5xx / network /
// no-status error is treated as a transient outage, retryable:true. Logs SID/status/numeric
// discriminators ONLY — never business-info PII (legal name, EIN, contact details) crosses into
// the log line.
export class TwilioA2pGateway implements A2pGateway {
  private readonly ops: A2pOps;

  constructor(
    accountSid: string,
    authToken: string,
    private readonly primaryProfileSid: string,
    private readonly statusCallbackUrl: string,
    ops?: A2pOps,
  ) {
    const client = twilio(accountSid, authToken, { timeout: 15_000 });
    this.ops = ops ?? buildTwilioA2pOps(client);
  }

  private async wrap<T>(op: string, fn: () => Promise<T>): Promise<Result<T, ExternalServiceError>> {
    try {
      return ok(await fn());
    } catch (e) {
      const status = errStatus(e);
      const retryable = !(status !== undefined && status < 500);
      logger.error({ provider: "twilio-a2p", op, code: errCode(e), status }, "twilio-a2p.op failed");
      return err(
        externalService("twilio-a2p", `the A2P registration step (${op}) could not be completed`, retryable),
      );
    }
  }

  async createSecondaryProfile(cmd: {
    orgId: string;
    info: BusinessInfo;
  }): Promise<Result<{ profileSid: string }, ExternalServiceError>> {
    return this.wrap("createSecondaryProfile", async () => {
      const profile = await this.ops.createCustomerProfile({
        email: cmd.info.contactEmail,
        friendlyName: `${cmd.info.legalName} — Secondary Customer Profile`,
        statusCallback: this.statusCallbackUrl,
      });

      // TODO(verify vs Twilio SDK): the exact allowed values for business_identity/business_type/
      // business_regions_of_operation/business_industry come from Twilio's EndUserType reference
      // (client.trusthub.v1.endUserTypes / the ISV onboarding guide's business-information
      // fields), which was not exhaustively available without a live account. The attribute NAMES
      // (business_name, business_industry, business_registration_identifier,
      // business_registration_number, business_type, business_regions_of_operation, website_url)
      // are confirmed from the twilio@6.0.2 EndUser create() type declaration; the VALUES below
      // are a best-faith attempt.
      const businessInfoEndUser = await this.ops.createEndUser({
        friendlyName: `${cmd.info.legalName} business information`,
        type: "customer_profile_business_information",
        attributes: {
          business_name: cmd.info.legalName,
          business_industry: cmd.info.industry,
          business_registration_identifier: cmd.info.ein ? "EIN" : "NONE",
          business_registration_number: cmd.info.ein ?? "",
          business_type: cmd.info.ein ? "Limited Liability Corporation" : "Sole Proprietorship",
          business_regions_of_operation: "USA_AND_CANADA",
          website_url: cmd.info.websiteUrl,
        },
      });
      await this.ops.assignEntity({ profileSid: profile.sid, objectSid: businessInfoEndUser.sid });

      // TODO(verify vs Twilio SDK): business_title/job_position values ("Owner") are a
      // placeholder — BusinessInfo (../domain/registration.ts) has no contact-title field today.
      const repEndUser = await this.ops.createEndUser({
        friendlyName: `${cmd.info.contactFirstName} ${cmd.info.contactLastName}`,
        type: "authorized_representative_1",
        attributes: {
          first_name: cmd.info.contactFirstName,
          last_name: cmd.info.contactLastName,
          email: cmd.info.contactEmail,
          phone_number: cmd.info.contactPhone,
          business_title: "Owner",
          job_position: "Owner",
        },
      });
      await this.ops.assignEntity({ profileSid: profile.sid, objectSid: repEndUser.sid });

      const address = await this.ops.createAddress({
        customerName: cmd.info.legalName,
        street: cmd.info.addressStreet,
        city: cmd.info.addressCity,
        region: cmd.info.addressRegion,
        postalCode: cmd.info.addressPostal,
        isoCountry: "US",
      });
      const supportingDoc = await this.ops.createSupportingDocument({
        friendlyName: `${cmd.info.legalName} address document`,
        type: "customer_profile_address",
        attributes: { address_sids: address.sid },
      });
      await this.ops.assignEntity({ profileSid: profile.sid, objectSid: supportingDoc.sid });

      // Attaches Mallet's APPROVED Primary Customer Profile as an entity on this secondary
      // profile, establishing the ISV/reseller relationship (the Owen prerequisite in the task
      // brief header — the primary profile must already be approved as "ISV Reseller or Partner").
      await this.ops.assignEntity({ profileSid: profile.sid, objectSid: this.primaryProfileSid });

      const evaluation = await this.ops.evaluateProfile({ profileSid: profile.sid });
      if (evaluation.status !== "compliant") {
        // Deterministic per-request failure (bad/incomplete business info) — classified as a 4xx
        // so the caller sees a non-retryable error rather than an outage.
        throw Object.assign(new Error("secondary profile failed compliance evaluation"), {
          status: 400,
        });
      }

      await this.ops.submitProfile(profile.sid);

      return { profileSid: profile.sid };
    });
  }

  async registerBrand(cmd: {
    profileSid: string;
    kind: "standard" | "sole_proprietor";
  }): Promise<Result<{ brandSid: string }, ExternalServiceError>> {
    return this.wrap("registerBrand", async () => {
      const brand = await this.ops.createBrand({
        customerProfileBundleSid: cmd.profileSid,
        a2PProfileBundleSid: cmd.profileSid,
        brandType: cmd.kind === "sole_proprietor" ? "SOLE_PROPRIETOR" : "STANDARD",
      });
      return { brandSid: brand.sid };
    });
  }

  async createMessagingService(cmd: {
    orgId: string;
  }): Promise<Result<{ messagingServiceSid: string }, ExternalServiceError>> {
    return this.wrap("createMessagingService", async () => {
      const service = await this.ops.createMessagingService({
        friendlyName: `Mallet A2P — ${cmd.orgId}`,
      });
      return { messagingServiceSid: service.sid };
    });
  }

  async registerCampaign(cmd: {
    messagingServiceSid: string;
    brandSid: string;
    content: CampaignContent;
  }): Promise<Result<{ campaignSid: string }, ExternalServiceError>> {
    return this.wrap("registerCampaign", async () => {
      const campaign = await this.ops.createCampaign({
        messagingServiceSid: cmd.messagingServiceSid,
        brandRegistrationSid: cmd.brandSid,
        content: cmd.content,
      });
      return { campaignSid: campaign.sid };
    });
  }

  async attachNumber(cmd: {
    messagingServiceSid: string;
    phoneNumberSid: string;
  }): Promise<Result<void, ExternalServiceError>> {
    return this.wrap("attachNumber", async () => {
      await this.ops.attachNumberToService(cmd);
    });
  }

  async fetchStatus(cmd: {
    profileSid: string | null;
    brandSid: string | null;
    campaignSid: string | null;
    messagingServiceSid: string | null;
  }): Promise<Result<{ profile: RemoteStatus; brand: RemoteStatus; campaign: RemoteStatus }, ExternalServiceError>> {
    return this.wrap("fetchStatus", async () => {
      const [profile, brand, campaign] = await Promise.all([
        cmd.profileSid ? this.ops.fetchProfileStatus(cmd.profileSid) : Promise.resolve<RemoteStatus>("unknown"),
        cmd.brandSid ? this.ops.fetchBrandStatus(cmd.brandSid) : Promise.resolve<RemoteStatus>("unknown"),
        // The campaign resource is nested under the messaging service — both SIDs are required to
        // address it; without messagingServiceSid there is no way to look up the campaign, so this
        // resolves "unknown" rather than guessing.
        cmd.campaignSid && cmd.messagingServiceSid
          ? this.ops.fetchCampaignStatus({ messagingServiceSid: cmd.messagingServiceSid, campaignSid: cmd.campaignSid })
          : Promise.resolve<RemoteStatus>("unknown"),
      ]);
      return { profile, brand, campaign };
    });
  }
}

// Fallback binding: used when TWILIO_PRIMARY_PROFILE_SID (or the account credentials) is absent,
// so dev/test boots without Twilio A2P secrets configured (mirrors LoggingNotificationSender).
// Returns deterministic fake SIDs and logs — never claims a real submission happened.
export class LoggingA2pGateway implements A2pGateway {
  async createSecondaryProfile(cmd: {
    orgId: string;
    info: BusinessInfo;
  }): Promise<Result<{ profileSid: string }, ExternalServiceError>> {
    logger.info({ orgId: cmd.orgId }, "a2p.stub.createSecondaryProfile");
    return ok({ profileSid: "BU-stub" });
  }

  async registerBrand(cmd: {
    profileSid: string;
    kind: "standard" | "sole_proprietor";
  }): Promise<Result<{ brandSid: string }, ExternalServiceError>> {
    logger.info({ profileSid: cmd.profileSid, kind: cmd.kind }, "a2p.stub.registerBrand");
    return ok({ brandSid: "BN-stub" });
  }

  async createMessagingService(cmd: {
    orgId: string;
  }): Promise<Result<{ messagingServiceSid: string }, ExternalServiceError>> {
    logger.info({ orgId: cmd.orgId }, "a2p.stub.createMessagingService");
    return ok({ messagingServiceSid: "MG-stub" });
  }

  async registerCampaign(cmd: {
    messagingServiceSid: string;
    brandSid: string;
    content: CampaignContent;
  }): Promise<Result<{ campaignSid: string }, ExternalServiceError>> {
    logger.info(
      { messagingServiceSid: cmd.messagingServiceSid, brandSid: cmd.brandSid },
      "a2p.stub.registerCampaign",
    );
    return ok({ campaignSid: "QE-stub" });
  }

  async attachNumber(cmd: {
    messagingServiceSid: string;
    phoneNumberSid: string;
  }): Promise<Result<void, ExternalServiceError>> {
    logger.info({ messagingServiceSid: cmd.messagingServiceSid }, "a2p.stub.attachNumber");
    return ok(undefined);
  }

  async fetchStatus(cmd: {
    profileSid: string | null;
    brandSid: string | null;
    campaignSid: string | null;
    messagingServiceSid: string | null;
  }): Promise<Result<{ profile: RemoteStatus; brand: RemoteStatus; campaign: RemoteStatus }, ExternalServiceError>> {
    logger.info(
      {
        profileSid: cmd.profileSid,
        brandSid: cmd.brandSid,
        campaignSid: cmd.campaignSid,
        messagingServiceSid: cmd.messagingServiceSid,
      },
      "a2p.stub.fetchStatus",
    );
    // NEVER "approved": AdvanceA2pRegistrationUseCase is the only writer of `active`, and its own doc
    // comment names a scheduled poll over many orgs as an intended caller. If that poll is ever wired
    // while A2P config is stubbed (a reachable state — see trpc/di.ts's config asymmetry: the SMS
    // channel needs only 3 vars, the A2P gateway needs 4), an all-"approved" stub would auto-flip
    // every polled org to `active` with no real registration ever having happened, silently reopening
    // the whole gate. "pending" never advances a registration on its own — matching the spirit of
    // LoggingNotificationSender, which never claims a real delivery either.
    return ok({ profile: "pending", brand: "pending", campaign: "pending" });
  }
}

// Exported for a future config-driven composition root (mirrors how stripe-connect-gateway's
// caller decides StripeConnectGateway vs a logging fallback based on config presence).
export const A2P_CAMPAIGN_USECASE = CAMPAIGN_USECASE;
