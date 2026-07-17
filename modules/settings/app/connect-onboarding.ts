import { ok, err, type Result, type AppError, type Clock } from "@mallet/shared/types";
import { OrgSettings } from "../domain/org-settings";
import type { SettingsRepository } from "../domain/settings-repository";
import type { ConnectGateway } from "../domain/connect-gateway";

export interface ConnectStatusView {
  readonly connected: boolean;
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly detailsSubmitted: boolean;
}

/**
 * Start (or resume) Express onboarding. Creates the connected account on first run, persists its id,
 * then mints a FRESH Stripe-hosted onboarding link to redirect the shop to. Reuses an existing
 * account id on later runs (so a re-click resumes onboarding rather than minting a duplicate).
 */
export class BeginConnectOnboardingUseCase {
  constructor(
    private readonly gateway: ConnectGateway,
    private readonly repo: SettingsRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: {
    orgId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<Result<{ url: string }, AppError>> {
    const settings = await this.repo.getConfig(cmd.orgId, OrgSettings.defaultBooking);
    let accountId = settings.props.stripeConnectedAccountId;

    if (!accountId) {
      const created = await this.gateway.createConnectedAccount({ orgId: cmd.orgId });
      if (!created.ok) return err(created.error);
      accountId = created.value.accountId;
      const patched = settings.patchStripe({ connectedAccountId: accountId }, this.clock.now());
      if (!patched.ok) return err(patched.error);
      await this.repo.saveConfig(patched.value);
    }

    const link = await this.gateway.createOnboardingLink({
      accountId,
      returnUrl: cmd.returnUrl,
      refreshUrl: cmd.refreshUrl,
    });
    if (!link.ok) return err(link.error);
    return ok({ url: link.value.url });
  }
}

/**
 * Pull the latest onboarding/capability status from Stripe and persist it. Stamps onboardedAt the
 * first time charges go live. No-ops to not-connected when the org has no account yet (no Stripe call).
 */
export class RefreshConnectStatusUseCase {
  constructor(
    private readonly gateway: ConnectGateway,
    private readonly repo: SettingsRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: { orgId: string }): Promise<Result<ConnectStatusView, AppError>> {
    const settings = await this.repo.getConfig(cmd.orgId, OrgSettings.defaultBooking);
    const accountId = settings.props.stripeConnectedAccountId;
    if (!accountId) {
      return ok({ connected: false, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false });
    }

    const statusResult = await this.gateway.retrieveStatus(accountId);
    if (!statusResult.ok) return err(statusResult.error);
    const status = statusResult.value;

    // Stamp onboardedAt once — the first time charges go live and it has not been stamped before.
    const onboardedAt =
      status.chargesEnabled && settings.props.stripeOnboardedAt === null
        ? this.clock.now()
        : settings.props.stripeOnboardedAt;

    const patched = settings.patchStripe(
      {
        chargesEnabled: status.chargesEnabled,
        payoutsEnabled: status.payoutsEnabled,
        detailsSubmitted: status.detailsSubmitted,
        onboardedAt,
      },
      this.clock.now(),
    );
    if (!patched.ok) return err(patched.error);
    await this.repo.saveConfig(patched.value);

    return ok({
      connected: status.chargesEnabled,
      chargesEnabled: status.chargesEnabled,
      payoutsEnabled: status.payoutsEnabled,
      detailsSubmitted: status.detailsSubmitted,
    });
  }
}
