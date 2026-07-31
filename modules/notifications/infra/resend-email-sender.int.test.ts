import { describe, it, expect } from "vitest";
import { asOrgId, systemClock, isOk } from "@mallet/shared/types";
import { ResendEmailSender } from "./resend-email-sender";

// OPT-IN live send against the real Resend API — actually delivers an email, so it is gated on an
// explicit RESEND_LIVE_TEST flag (NOT just RESEND_API_KEY, which lives in .env.local and would
// otherwise spam the inbox on every `pnpm test:int`). To run:
//   RESEND_LIVE_TEST=1 RESEND_TEST_TO=you@yourdomain.com pnpm test:int -- resend-email-sender.int
// With an unverified Resend account, send from onboarding@resend.dev to the account owner's email.
const live = Boolean(process.env.RESEND_LIVE_TEST && process.env.RESEND_API_KEY);
const suite = live ? describe : describe.skip;

const FROM = process.env.RESEND_TEST_FROM ?? "onboarding@resend.dev";
const TO = process.env.RESEND_TEST_TO ?? "delivered@resend.dev"; // Resend's sandbox sink address

suite("ResendEmailSender against live Resend", () => {
  it("sends a real email and returns the provider message id", async () => {
    const sender = new ResendEmailSender(process.env.RESEND_API_KEY as string, FROM, systemClock);
    const result = await sender.send({
      orgId: asOrgId("22222222-2222-4222-8222-222222222222"),
      channel: "email",
      to: TO,
      body: "Elas live email integration test.",
      kind: "invoice_sent",
      idempotencyKey: `int-email-${Date.now()}`,
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.externalId).toMatch(/.+/);
  });
});
