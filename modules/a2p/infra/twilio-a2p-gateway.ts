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
// Confirmed by directly fetching the ISV onboarding guide (Jul 2026): the guide quotes this exact
// SID as "the Policy (rule set) that defines which information is required for a CustomerProfile"
// for the Secondary Customer Profile step.
const SECONDARY_CUSTOMER_PROFILE_POLICY_SID = "RNdfbf3fae0e1107f8aded0e7cead80bf5";
// TODO(verify live): the A2P Trust Bundle (TrustProduct) policySid. The ISV onboarding guide
// (https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api, "Create an A2P
// Profile" / "Create and submit a TrustProduct" step, which appears AFTER the Secondary Customer
// Profile section) documents this value, but that section is beyond what automated fetches of the
// page could retrieve (the page truncates mid-guide). No independent secondary source could
// corroborate a specific SID, so this is left as an obviously-fake placeholder (matching Twilio's
// own doc convention of `RNaaaa...` example SIDs) rather than risk hardcoding a wrong constant.
// Confirm the real value via `client.trusthub.v1.policies.list()` on a live account (filter
// friendlyName ~ "A2P Messaging Profile") or by reading that guide section directly, then replace
// this placeholder before any live submission.
const A2P_TRUST_BUNDLE_POLICY_SID = "RNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
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
  // The A2P Trust Bundle (a TrustProduct, trusthub.v1.trustProducts — NOT a CustomerProfile) that
  // registerBrand assembles before brand creation. See createBrandOp's doc comment: brand
  // registration needs a customer-profile bundle SID AND a separate A2P Messaging Profile bundle
  // SID, confirmed distinct via node_modules/twilio/lib/rest/messaging/v1/brandRegistration.d.ts
  // and https://www.twilio.com/docs/messaging/api/brand-registration-resource.
  fetchProfileDetails(profileSid: string): Promise<{ friendlyName: string; email: string }>;
  createA2pTrustBundle(cmd: { friendlyName: string; email: string; statusCallback: string }): Promise<{ sid: string }>;
  assignTrustBundleEntity(cmd: { trustBundleSid: string; objectSid: string }): Promise<void>;
  evaluateTrustBundle(cmd: { trustBundleSid: string }): Promise<{ status: "compliant" | "noncompliant" }>;
  submitTrustBundle(trustBundleSid: string): Promise<void>;
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

// RESOLVED (was TODO(verify vs Twilio SDK)): confirmed via
// node_modules/twilio/lib/rest/messaging/v1/brandRegistration.d.ts (BrandRegistrationListInstanceCreateOptions:
// `customerProfileBundleSid` and `a2PProfileBundleSid` are two distinct required string fields) and
// https://www.twilio.com/docs/messaging/api/brand-registration-resource, which documents
// a2PProfileBundleSid as "the SID of the TrustProduct resource associated with the business" — a
// SEPARATE TrustHub resource (trusthub.v1.trustProducts, an "A2P Messaging Profile" bundle), not
// the secondary Customer Profile bundle. registerBrand (below) now assembles that TrustProduct
// (create -> assign the secondary profile as an entity -> evaluate -> submit) before calling this,
// mirroring the createSecondaryProfile assembly. See A2P_TRUST_BUNDLE_POLICY_SID above for the one
// remaining unconfirmed piece (the exact policySid).
async function createBrandOp(
  client: Client,
  cmd: { customerProfileBundleSid: string; a2PProfileBundleSid: string; brandType: "STANDARD" | "SOLE_PROPRIETOR" },
): Promise<{ sid: string }> {
  const brand = await client.messaging.v1.brandRegistrations.create(cmd);
  return { sid: brand.sid };
}

// Reads friendlyName/email off the already-created secondary Customer Profile so the A2P Trust
// Bundle can reuse them (avoids threading BusinessInfo through the A2pGateway.registerBrand port,
// which only carries profileSid + kind — see ../domain/a2p-gateway.ts). Confirmed field names via
// node_modules/twilio/lib/rest/trusthub/v1/customerProfiles.d.ts (CustomerProfilesResource:
// friendly_name, email).
async function fetchProfileDetailsOp(client: Client, profileSid: string): Promise<{ friendlyName: string; email: string }> {
  const profile = await client.trusthub.v1.customerProfiles(profileSid).fetch();
  return { friendlyName: profile.friendlyName, email: profile.email };
}

// Creates the A2P Trust Bundle (a TrustProduct, trusthub.v1.trustProducts) — confirmed distinct
// resource from customerProfiles via node_modules/twilio/lib/rest/trusthub/v1/trustProducts.d.ts
// (TrustProductsListInstanceCreateOptions: friendlyName, email, policySid, statusCallback? — same
// create shape as CustomerProfilesListInstanceCreateOptions).
async function createA2pTrustBundleOp(
  client: Client,
  cmd: { friendlyName: string; email: string; statusCallback: string },
): Promise<{ sid: string }> {
  const bundle = await client.trusthub.v1.trustProducts.create({
    friendlyName: cmd.friendlyName,
    email: cmd.email,
    policySid: A2P_TRUST_BUNDLE_POLICY_SID,
    statusCallback: cmd.statusCallback,
  });
  return { sid: bundle.sid };
}

// Attaches an object (here, the secondary Customer Profile bundle SID) to the A2P Trust Bundle —
// the same object-bag assignment pattern as assignEntityOp, confirmed via
// node_modules/twilio/lib/rest/trusthub/v1/trustProducts/trustProductsEntityAssignments.d.ts
// (TrustProductsEntityAssignmentsListInstanceCreateOptions: { objectSid }, identical shape to
// CustomerProfilesEntityAssignmentsListInstanceCreateOptions). Mirrors the existing
// primaryProfileSid -> secondary-profile entity assignment below (bundle-to-bundle assignment is
// already an established pattern in this file, not a new guess).
async function assignTrustBundleEntityOp(
  client: Client,
  cmd: { trustBundleSid: string; objectSid: string },
): Promise<void> {
  await client.trusthub.v1
    .trustProducts(cmd.trustBundleSid)
    .trustProductsEntityAssignments.create({ objectSid: cmd.objectSid });
}

// Confirmed via node_modules/twilio/lib/rest/trusthub/v1/trustProducts/trustProductsEvaluations.d.ts
// (TrustProductsEvaluationsStatus = "compliant" | "noncompliant" — identical union to the
// CustomerProfile evaluation status used by evaluateProfileOp above).
async function evaluateTrustBundleOp(
  client: Client,
  cmd: { trustBundleSid: string },
): Promise<{ status: "compliant" | "noncompliant" }> {
  const evaluation = await client.trusthub.v1
    .trustProducts(cmd.trustBundleSid)
    .trustProductsEvaluations.create({ policySid: A2P_TRUST_BUNDLE_POLICY_SID });
  return { status: evaluation.status };
}

// Moves the Trust Bundle from draft -> pending-review, same as submitProfileOp. Confirmed via
// node_modules/twilio/lib/rest/trusthub/v1/trustProducts.d.ts (TrustProductsStatus = "draft" |
// "pending-review" | "in-review" | "twilio-rejected" | "twilio-approved" — identical union to
// CustomerProfilesStatus).
async function submitTrustBundleOp(client: Client, trustBundleSid: string): Promise<void> {
  await client.trusthub.v1.trustProducts(trustBundleSid).update({ status: "pending-review" });
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
// RESOLVED (was TODO(verify vs Twilio SDK)): confirmed via
// node_modules/twilio/lib/rest/messaging/v1/service/usAppToPerson.d.ts — UsAppToPersonListInstance
// is callable as `(sid) => UsAppToPersonContext` scoped under a messagingServiceSid
// (UsAppToPersonContextSolution: { messagingServiceSid, sid }), and `.fetch()` resolves a
// UsAppToPersonInstance with `campaignStatus: string`. Both the nested path and the field name
// match what this function already does — no code change needed here.
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
// cross-checked against the twilio@6.0.2 type declarations and Twilio's public docs where noted.
// The a2PProfileBundleSid / A2P Trust Bundle gap that used to live here (createBrandOp's original
// TODO) is now implemented (see registerBrand's trust-bundle assembly) — the one remaining
// unconfirmed piece is A2P_TRUST_BUNDLE_POLICY_SID's exact value (see its TODO(verify live) above).
// Any other genuine plan-vs-SDK divergence is flagged with a precise TODO(verify live) rather than
// papered over — real-account verification of those is deferred to Owen.
function buildTwilioA2pOps(client: Client): A2pOps {
  return {
    createCustomerProfile: (cmd) => createCustomerProfileOp(client, cmd),
    createEndUser: (cmd) => createEndUserOp(client, cmd),
    createAddress: (cmd) => createAddressOp(client, cmd),
    createSupportingDocument: (cmd) => createSupportingDocumentOp(client, cmd),
    assignEntity: (cmd) => assignEntityOp(client, cmd),
    evaluateProfile: (cmd) => evaluateProfileOp(client, cmd),
    submitProfile: (profileSid) => submitProfileOp(client, profileSid),
    fetchProfileDetails: (profileSid) => fetchProfileDetailsOp(client, profileSid),
    createA2pTrustBundle: (cmd) => createA2pTrustBundleOp(client, cmd),
    assignTrustBundleEntity: (cmd) => assignTrustBundleEntityOp(client, cmd),
    evaluateTrustBundle: (cmd) => evaluateTrustBundleOp(client, cmd),
    submitTrustBundle: (trustBundleSid) => submitTrustBundleOp(client, trustBundleSid),
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

// RESOLVED (was TODO(verify vs Twilio SDK)): BrandRegistrationStatus is an EXHAUSTIVE documented
// union (not just examples) per node_modules/twilio/lib/rest/messaging/v1/brandRegistration.d.ts:
// "PENDING" | "APPROVED" | "FAILED" | "IN_REVIEW" | "DELETION_PENDING" | "DELETION_FAILED" |
// "SUSPENDED". PENDING / IN_REVIEW / DELETION_PENDING -> pending (still resolving — a deletion
// request hasn't concluded to a final outcome yet, same as an in-flight review); APPROVED ->
// approved; FAILED / DELETION_FAILED / SUSPENDED -> rejected. DELETION_FAILED and SUSPENDED both
// mean the brand can no longer send (confirmed for SUSPENDED via
// https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/troubleshooting-a2p-brands/troubleshooting-and-rectifying-a2p-campaigns-1:
// "While suspended, campaigns cannot be used to send messages") — mapping them to "rejected"
// (rather than "unknown") matters because AdvanceA2pRegistrationUseCase's rejectionReason() only
// acts on "rejected" and calls markFailed; "unknown" would leave a previously-active org frozen at
// status "active" (canText: true) forever after Twilio cuts it off. DELETION_PENDING is not
// reachable via any Mallet-initiated flow today (no brand-deletion code path exists), so its exact
// handling is a low-stakes judgment call, not a live-blocking unknown.
function mapBrandStatus(status: string): RemoteStatus {
  if (status === "APPROVED") return "approved";
  if (status === "FAILED" || status === "DELETION_FAILED" || status === "SUSPENDED") return "rejected";
  if (status === "PENDING" || status === "IN_REVIEW" || status === "DELETION_PENDING") return "pending";
  return "unknown";
}

// PARTIALLY RESOLVED (was TODO(verify vs Twilio SDK)): UsAppToPersonInstance.campaignStatus is
// typed as plain `string` (no exhaustive union) per
// node_modules/twilio/lib/rest/messaging/v1/service/usAppToPerson.d.ts, so unlike mapBrandStatus
// there is no SDK-level exhaustive list to check against. However, Twilio's docs
// (https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/troubleshooting-a2p-brands/troubleshooting-and-rectifying-a2p-campaigns-1)
// confirm a 4th named value beyond the "IN_PROGRESS, VERIFIED, FAILED" examples: "in some rare
// cases campaigns can be SUSPENDED" — while suspended, "campaigns cannot be used to send
// messages", i.e. no longer usable, same reasoning as mapBrandStatus's SUSPENDED handling above.
// TODO(verify live): campaignStatus still has no exhaustive documented enum — any value Twilio
// returns beyond these 4 named ones will fall through to "unknown" here.
function mapCampaignStatus(status: string): RemoteStatus {
  if (status === "VERIFIED") return "approved";
  if (status === "FAILED" || status === "SUSPENDED") return "rejected";
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

      // RESOLVED (was TODO(verify vs Twilio SDK)) — attribute KEY names: confirmed from the
      // twilio@6.0.2 EndUser create() type declaration (node_modules/twilio/lib/rest/trusthub/v1/endUser.d.ts,
      // `attributes?: any` — untyped, but the key set below matches Twilio's own documented
      // request-body example for a `customer_profile_business_information` EndUser) — business_name,
      // business_industry, business_registration_identifier, business_registration_number,
      // business_type, business_regions_of_operation, website_url are all real, used keys.
      //
      // Enum VALUES, confirmed via https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/collect-business-info:
      //  - business_industry: CONSTRUCTION (used by Mallet's plumbing/trades ICP) is a documented
      //    member of the published industry list (AGRICULTURE, ..., CONSTRUCTION, ..., TRAVEL).
      //    cmd.info.industry is real per-org input (BusinessInfo.industry), not a guess — but it is
      //    NOT validated against this enum at any boundary today; an org with a free-text industry
      //    outside the documented list would only fail at Twilio evaluation time, not before.
      //  - business_regions_of_operation: "USA_AND_CANADA" is a documented member (alongside
      //    AFRICA, ASIA, EUROPE, LATIN_AMERICA). Hardcoded deliberately, not a guess — Mallet's ICP
      //    (CLAUDE.md) is US trade shops only, so this is a legitimate constant, not a per-org input.
      //  - business_registration_identifier: the documented enum is EIN, DUNS, CBN, CN, ACN, CIN,
      //    VAT, VATRN, RN, Other. "EIN" (used when cmd.info.ein is present) is a confirmed member.
      //    TODO(verify live): "NONE" (used when cmd.info.ein is null) is NOT a documented member of
      //    that enum — Twilio publishes a wholly separate, simpler onboarding path for tax-ID-less
      //    businesses (https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api-sole-prop-new)
      //    that may not use business_registration_identifier at all. Confirm live whether a
      //    no-EIN org should route through that separate flow instead of this one with "NONE".
      //  - business_type: the documented enum includes "Sole Proprietorship" and "Limited
      //    Liability Corporation" (both used below), but two independent fetches of Twilio's docs
      //    gave inconsistent listings of the full set, so this enum could not be fully corroborated.
      //    TODO(verify live): more fundamentally, business_type here is INFERRED from
      //    EIN-presence-alone (`cmd.info.ein ? "...LLC" : "Sole Proprietorship"`) — BusinessInfo
      //    (../domain/registration.ts) has no real legal-entity-type field, so this is a heuristic,
      //    not sourced per-org input. Confirm against a live account whether this heuristic ever
      //    mismatches (e.g. a sole-EIN-less LLC, or an org with an EIN that isn't an LLC).
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

      // TODO(verify live): job_position/business_title are hardcoded to "Owner" — BusinessInfo
      // (../domain/registration.ts) has no contact-title field today, so this cannot be sourced
      // from real per-org input (not a guess left in by oversight — there is nothing to source it
      // from). Attribute key names (first_name, last_name, email, phone_number, business_title,
      // job_position) are confirmed real via Twilio's documented authorized_representative_1
      // EndUser example. Confirm live whether Twilio's evaluation is sensitive to job_position
      // wording (e.g. requires a title matching a real signing authority) before assuming "Owner"
      // always passes.
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
      // RESOLVED (was an implicit open question, not a tagged TODO): address_sids takes a SINGLE
      // Address SID string, not an array — confirmed via Twilio's documented customer_profile_address
      // SupportingDocument example, `"attributes": { "address_sids": "ADaaaa..." }`
      // (node_modules/twilio/lib/rest/trusthub/v1/supportingDocument.d.ts types `attributes` as
      // untyped `any`, so this shape can only be confirmed from the docs, not the SDK types). The
      // existing `address.sid` (a single string) already matches this shape — no change needed.
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
      // Assembles the A2P Trust Bundle (a TrustProduct distinct from the secondary Customer
      // Profile — see createBrandOp's doc comment) before brand creation, mirroring
      // createSecondaryProfile's create -> assign -> evaluate -> submit shape. friendlyName/email
      // are read off the already-created secondary profile rather than threaded through this
      // method's cmd, since A2pGateway.registerBrand (../domain/a2p-gateway.ts) only carries
      // profileSid + kind.
      const profileDetails = await this.ops.fetchProfileDetails(cmd.profileSid);
      const trustBundle = await this.ops.createA2pTrustBundle({
        friendlyName: `${profileDetails.friendlyName} — A2P Trust Bundle`,
        email: profileDetails.email,
        statusCallback: this.statusCallbackUrl,
      });
      await this.ops.assignTrustBundleEntity({ trustBundleSid: trustBundle.sid, objectSid: cmd.profileSid });

      const evaluation = await this.ops.evaluateTrustBundle({ trustBundleSid: trustBundle.sid });
      if (evaluation.status !== "compliant") {
        // Same non-retryable-4xx classification as createSecondaryProfile's compliance check.
        throw Object.assign(new Error("A2P trust bundle failed compliance evaluation"), {
          status: 400,
        });
      }
      await this.ops.submitTrustBundle(trustBundle.sid);

      const brand = await this.ops.createBrand({
        customerProfileBundleSid: cmd.profileSid,
        a2PProfileBundleSid: trustBundle.sid,
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
