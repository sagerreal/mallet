/**
 * CreateDepositCheckoutUseCase — mints the Stripe-hosted deposit payment for an ACCEPTED quote.
 *
 * Every rejection here is read by a customer holding a link, not by the office, so the messages
 * are asserted for what they must NOT contain as much as what they say: no "Connect", no
 * "onboarding", no "Settings → Payments", no estimate ids.
 */
import { describe, it, expect } from "vitest";
import { asOrgId, isOk, money, zeroMoney } from "@mallet/shared/types";
import { PLATFORM_FEE_BPS } from "@mallet/platform/payments/platform-fee";
import { CreateDepositCheckoutUseCase } from "./create-deposit-checkout";
import {
  ORG,
  EST,
  TOKEN,
  acceptedEstimate,
  estimateLine,
  connectReady,
  collectingGateway,
  failingGateway,
} from "./quote-deposit.fixtures";

const OFFICE_JARGON = /connect|onboard|settings|stripe|account/i;

const repoFor = (estimate = acceptedEstimate()) => ({
  findById: async (id: string) => (id === estimate.props.id ? estimate : null),
});

describe("CreateDepositCheckoutUseCase", () => {
  it("mints a checkout for the outstanding deposit when accepted + due + charges enabled", async () => {
    const { calls, gateway } = collectingGateway();
    const useCase = new CreateDepositCheckoutUseCase(repoFor(), gateway, connectReady());

    const result = await useCase.exec({ orgId: ORG, estimateId: EST, returnToken: TOKEN });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.url).toBe("https://checkout.stripe.com/c/pay/cs_dep_1");
    expect(calls).toHaveLength(1);
    const cmd = calls[0]!;
    expect(cmd.amountCents).toBe(30_000); // 30% of $1,000
    expect(cmd.currency).toBe("usd");
    expect(cmd.connectedAccountId).toBe("acct_live_1");
    // Same destination-charge convention as an invoice payment: 25 bps to the platform.
    expect(PLATFORM_FEE_BPS).toBe(25);
    expect(cmd.applicationFeeCents).toBe(75); // round(30000 * 25 / 10000)
    expect(cmd.description).toContain("EST-1000");
    expect(cmd.returnToken).toBe(TOKEN);
    // Stable per (org, estimate, amount, destination, fee) so a double tap reuses the session.
    expect(cmd.idempotencyKey).toBe(`dep:${ORG}:${EST}:30000:acct_live_1:75`);
  });

  it("charges only the REMAINDER when part of the deposit is already paid", async () => {
    const { calls, gateway } = collectingGateway();
    const useCase = new CreateDepositCheckoutUseCase(
      repoFor(acceptedEstimate({ depPaid: money(10_000) })),
      gateway,
      connectReady(),
    );

    const result = await useCase.exec({ orgId: ORG, estimateId: EST, returnToken: TOKEN });

    expect(isOk(result)).toBe(true);
    expect(calls[0]!.amountCents).toBe(20_000);
  });

  it("refuses an unapproved quote, in words a customer can act on", async () => {
    const { calls, gateway } = collectingGateway();
    const useCase = new CreateDepositCheckoutUseCase(
      repoFor(acceptedEstimate({ status: "sent", acceptedAt: null })),
      gateway,
      connectReady(),
    );

    const result = await useCase.exec({ orgId: ORG, estimateId: EST, returnToken: TOKEN });

    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.kind).toBe("conflict");
    expect(result.error.message).toMatch(/approve/i);
    expect(result.error.message).not.toMatch(OFFICE_JARGON);
    expect(calls).toHaveLength(0);
  });

  it("refuses when nothing is owed — a fully paid deposit has no checkout to mint", async () => {
    const { calls, gateway } = collectingGateway();
    const useCase = new CreateDepositCheckoutUseCase(
      repoFor(acceptedEstimate({ depPaid: money(30_000) })),
      gateway,
      connectReady(),
    );

    const result = await useCase.exec({ orgId: ORG, estimateId: EST, returnToken: TOKEN });

    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.message).toMatch(/deposit/i);
    expect(result.error.message).not.toMatch(OFFICE_JARGON);
    expect(calls).toHaveLength(0);
  });

  it("refuses when the shop cannot take cards, and never names the shop's setup screens", async () => {
    const { calls, gateway } = collectingGateway();
    const useCase = new CreateDepositCheckoutUseCase(
      repoFor(),
      gateway,
      connectReady({ connectedAccountId: null, chargesEnabled: false }),
    );

    const result = await useCase.exec({ orgId: ORG, estimateId: EST, returnToken: TOKEN });

    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.kind).toBe("conflict");
    expect(result.error.message).toMatch(/contact/i);
    expect(result.error.message).not.toMatch(OFFICE_JARGON);
    expect(calls).toHaveLength(0);
  });

  it("refuses a deposit under the card minimum instead of sending a request Stripe will reject", async () => {
    const { calls, gateway } = collectingGateway();
    // $1.00 job at 30% = 30¢, under the 50¢ USD Checkout minimum.
    const useCase = new CreateDepositCheckoutUseCase(
      repoFor(acceptedEstimate({ lines: [estimateLine(100)], depPaid: zeroMoney })),
      gateway,
      connectReady(),
    );

    const result = await useCase.exec({ orgId: ORG, estimateId: EST, returnToken: TOKEN });

    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.message).not.toMatch(OFFICE_JARGON);
    expect(calls).toHaveLength(0);
  });

  it("refuses a missing estimate", async () => {
    const { gateway } = collectingGateway();
    const useCase = new CreateDepositCheckoutUseCase(
      { findById: async () => null },
      gateway,
      connectReady(),
    );
    const result = await useCase.exec({ orgId: ORG, estimateId: EST, returnToken: TOKEN });
    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.kind).toBe("not_found");
  });

  it("refuses an estimate belonging to another org", async () => {
    const { gateway } = collectingGateway();
    const useCase = new CreateDepositCheckoutUseCase(repoFor(), gateway, connectReady());
    const result = await useCase.exec({
      orgId: asOrgId("77777777-7777-4777-8777-777777777777"),
      estimateId: EST,
      returnToken: TOKEN,
    });
    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.kind).toBe("not_found");
  });

  it("surfaces a provider outage as an external_service error, not a rejection", async () => {
    const useCase = new CreateDepositCheckoutUseCase(repoFor(), failingGateway(), connectReady());
    const result = await useCase.exec({ orgId: ORG, estimateId: EST, returnToken: TOKEN });
    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.kind).toBe("external_service");
  });
});
