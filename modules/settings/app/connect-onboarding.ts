import { ok, err, type Result, type AppError, type Clock } from "@mallet/shared/types";
import { OrgSettings } from "../domain/org-settings";
import type { SettingsRepository } from "../domain/settings-repository";
import type { ConnectGateway } from "../domain/connect-gateway";

/**
 * Runs a unit of settings work inside its OWN committed org-scoped transaction and returns the
 * result. Each call is an independent commit — the caller (a NoTx tRPC procedure) supplies a runner
 * that opens a fresh `withTenant` tx and builds an org-bound repository. This lets the onboarding
 * flow durably persist the connected account id BEFORE the fallible external link step, so a link
 * failure can never roll back the saved id (which would orphan the real Stripe account).
 */
export type SettingsTenantRunner = <T>(fn: (repo: SettingsRepository) => Promise<T>) => Promise<T>;

// The onboarding/capability status projected to the UI. `hasAccount` = onboarding has begun (an
// acct_ id is stored); `detailsSubmitted` = the shop finished Stripe's hosted form; charges/payouts
// are the live capability flags (can legitimately lag behind detailsSubmitted during verification).
export interface ConnectStatusView {
  readonly hasAccount: boolean;
  readonly detailsSubmitted: boolean;
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
}

/**
 * Start (or resume) Express onboarding. On first run: creates the connected account (OUTSIDE any DB
 * tx), then persists its id in its own committed tx, then mints a FRESH Stripe-hosted onboarding
 * link (also outside any tx). Reuses an existing account id on later runs. Ordering is deliberate:
 * the durable external side effect (account create) is committed to the DB before the fallible link
 * mint, so a link failure leaves the id stored and the next click resumes rather than duplicating.
 */
export class BeginConnectOnboardingUseCase {
  constructor(
    private readonly gateway: ConnectGateway,
    private readonly run: SettingsTenantRunner,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: {
    orgId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<Result<{ url: string }, AppError>> {
    // 1. Read the current account id in its own tx (a plain read, commits immediately).
    let accountId = await this.run(async (repo) => {
      const settings = await repo.getConfig(cmd.orgId, OrgSettings.defaultBooking);
      return settings.props.stripeConnectedAccountId;
    });

    // 2. No account yet → create it (external, NO tx open), then persist the id in its OWN committed
    //    tx. If persistence throws, the tx rolls back but the stable idempotency key means a retry
    //    returns the SAME account — no orphan.
    if (!accountId) {
      const created = await this.gateway.createConnectedAccount({ orgId: cmd.orgId });
      if (!created.ok) return err(created.error);
      const newAccountId = created.value.accountId;

      const saved = await this.run(async (repo): Promise<Result<null, AppError>> => {
        const settings = await repo.getConfig(cmd.orgId, OrgSettings.defaultBooking);
        // Re-check under this tx: a concurrent request may have already stored an id.
        if (settings.props.stripeConnectedAccountId) return ok(null);
        const patched = settings.patchStripe({ connectedAccountId: newAccountId }, this.clock.now());
        if (!patched.ok) return err(patched.error);
        await repo.saveConfig(patched.value);
        return ok(null);
      });
      if (!saved.ok) return err(saved.error);
      accountId = newAccountId;
    }

    // 3. Mint a fresh onboarding link (external, NO tx open). A failure here leaves the id committed.
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
 * Pull the latest onboarding/capability status from Stripe and persist it. Reads the account id in a
 * tx, calls Stripe OUTSIDE any tx (never holding a tx open across the external call), then persists
 * the status in its own tx. Stamps onboardedAt the first time charges go live. No-ops to
 * not-connected when the org has no account yet (no Stripe call).
 */
export class RefreshConnectStatusUseCase {
  constructor(
    private readonly gateway: ConnectGateway,
    private readonly run: SettingsTenantRunner,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: { orgId: string }): Promise<Result<ConnectStatusView, AppError>> {
    const accountId = await this.run(async (repo) => {
      const settings = await repo.getConfig(cmd.orgId, OrgSettings.defaultBooking);
      return settings.props.stripeConnectedAccountId;
    });
    if (!accountId) {
      return ok({ hasAccount: false, detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false });
    }

    const statusResult = await this.gateway.retrieveStatus(accountId);
    if (!statusResult.ok) return err(statusResult.error);
    const status = statusResult.value;

    const persisted = await this.run(async (repo): Promise<Result<null, AppError>> => {
      const settings = await repo.getConfig(cmd.orgId, OrgSettings.defaultBooking);
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
      await repo.saveConfig(patched.value);
      return ok(null);
    });
    if (!persisted.ok) return err(persisted.error);

    return ok({
      hasAccount: true,
      detailsSubmitted: status.detailsSubmitted,
      chargesEnabled: status.chargesEnabled,
      payoutsEnabled: status.payoutsEnabled,
    });
  }
}
