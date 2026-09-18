import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { orgs } from "@mallet/shared/db/schema";
import { withTenant } from "@mallet/shared/db/tx";
import { router, ownerOrOffice, ownerOrOfficeNoTx } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { DrizzleRegistrationRepository } from "../infra/drizzle-registration-repository";
import { LoggingA2pGateway } from "../infra/twilio-a2p-gateway";
import { GetA2pStatusUseCase } from "../app/get-status";
import { BeginA2pRegistrationUseCase, type A2pTenantRunner } from "../app/begin-registration";
import {
  buildConsentDescription,
  buildSampleMessages,
  buildOptInMessage,
  buildSmsTermsSection,
} from "../app/generate-consent";
import type { BusinessInfo } from "../domain/registration";
import {
  businessInfoDTO,
  a2pStatusViewDTO,
  submitResultDTO,
  toBusinessInfo,
  previewConsentInputDTO,
  consentPreviewDTO,
} from "./a2p-dto";

// Only legalName is consumed by the pure generators below (every build* function reads
// exclusively info.legalName) — the rest of BusinessInfo is a fixed, never-rendered stub that
// exists purely to satisfy the parameter type, so the preview can run before the shop has
// filled in the rest of the business form.
function stubBusinessInfo(legalName: string): BusinessInfo {
  return {
    legalName,
    ein: null,
    addressStreet: "",
    addressCity: "",
    addressRegion: "",
    addressPostal: "",
    industry: "",
    websiteUrl: "",
    contactFirstName: "",
    contactLastName: "",
    contactEmail: "",
    contactPhone: "",
  };
}

// Layer 5: thin transport. Org is ALWAYS ctx.principal.orgId, never client input.
export const createA2pRouter = () =>
  router({
    // Read-only projection of the org's registration state. Runs inside the ambient org tx
    // (ownerOrOffice) — a single call, so the tenant runner just wraps the already-open tx rather
    // than opening a fresh one (contrast with submitAndRegister below).
    getStatus: ownerOrOffice.output(a2pStatusViewDTO).query(async ({ ctx }) => {
      const repo = new DrizzleRegistrationRepository(ctx.tx, ctx.principal.orgId);
      const run: A2pTenantRunner = (fn) => fn(repo);
      return new GetA2pStatusUseCase(run).exec(ctx.principal.orgId);
    }),

    // Drives the full external A2P registration sequence (BeginA2pRegistrationUseCase). Mirrors
    // settings' payments.beginOnboarding: ownerOrOfficeNoTx + a per-op tenant runner so each
    // durable external SID commits in its OWN short transaction — no tx stays open across the
    // (slow, multi-call) Twilio round-trips.
    submitAndRegister: ownerOrOfficeNoTx
      .input(businessInfoDTO)
      .output(submitResultDTO)
      .mutation(async ({ ctx, input }) => {
        const orgId = ctx.principal.orgId;

        // The org's provisioned Twilio business number (E.164 — orgs.twilio_number), read in its
        // own short tx. NOTE: this is NOT a Twilio Phone Number resource SID (the "PNxxxxxxxx…"
        // id Twilio's Messaging Service phoneNumbers.create()/A2pGateway.attachNumber expect) —
        // there is no persisted mapping anywhere in this schema from an org's number to that
        // resource SID yet (no column, no lookup). Passed through as the best available signal
        // per the task-10 brief (flagged, not invented); resolving the real PN resource SID
        // (e.g. a Twilio Incoming-Phone-Numbers lookup-by-number, or a new persisted column) is a
        // follow-up — see task-10-report.md.
        const [org] = await withTenant(orgId, (tx) =>
          tx.select({ twilioNumber: orgs.twilioNumber }).from(orgs).where(eq(orgs.id, orgId)).limit(1),
        );
        const twilioNumber = org?.twilioNumber ?? null;
        if (!twilioNumber) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "this org has no provisioned Twilio number yet — provision a number before starting A2P registration",
          });
        }

        const run: A2pTenantRunner = (fn) =>
          withTenant(orgId, (tx) => fn(new DrizzleRegistrationRepository(tx, orgId)));

        // Real gateway when Twilio A2P config is present (composition root, trpc/di.ts); else the
        // logging stub, so this boots without secrets — same optional-dep + `??` fallback as
        // ctx.deps.notificationSender.
        const gateway = ctx.deps.a2pGateway ?? new LoggingA2pGateway();

        const result = await new BeginA2pRegistrationUseCase(gateway, run, ctx.deps.clock).exec({
          orgId,
          info: toBusinessInfo(input),
          phoneNumberSid: twilioNumber,
        });
        return orThrow(result);
      }),

    // Read-only preview of the generated consent/sample-messages/opt-in/SMS-terms — computed
    // from the SAME pure generators submitAndRegister uses to build CampaignContent, so the
    // wizard's preview is guaranteed to match what actually gets submitted (one source of
    // truth). No DB access needed; pure and side-effect-free.
    previewConsent: ownerOrOffice.input(previewConsentInputDTO).output(consentPreviewDTO).query(({ input }) => {
      const info = stubBusinessInfo(input.legalName);
      return {
        consentDescription: buildConsentDescription(info),
        sampleMessages: buildSampleMessages(info),
        optInMessage: buildOptInMessage(info),
        smsTerms: buildSmsTermsSection(info),
      };
    }),
  });
