import type { Clock, Result, AppError } from "@mallet/shared/types";
import { ok, err, notFound } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { SecretBox } from "@mallet/platform/crypto/secret-box";
import type { QboOauthGateway } from "../domain/qbo-oauth-gateway";
import type { TenantRunner } from "./complete-qbo-connect";

/**
 * Disconnect QuickBooks for this org.
 *
 * Local disconnection is what the shop actually asked for, so it MUST succeed even if Intuit is
 * unreachable. We make a best-effort revoke first — it's the polite thing and it invalidates the
 * token on Intuit's side — but a failure there is logged and swallowed rather than leaving the
 * shop stuck "connected" to something they've told us to drop.
 */
export class DisconnectQbo {
  constructor(
    private readonly runInTenant: TenantRunner,
    private readonly gateway: QboOauthGateway,
    private readonly box: SecretBox,
    private readonly clock: Clock,
  ) {}

  async exec(orgId: string): Promise<Result<void, AppError>> {
    // Read in its own short tx; the revoke round-trip below happens between transactions rather
    // than holding one open across the network (same rule as CompleteQboConnect).
    const connection = await this.runInTenant((repo) => repo.get());
    if (!connection) return err(notFound("QuickBooks is not connected"));

    // Already disconnected — succeed quietly. Clicking Disconnect twice is not an error.
    if (connection.props.status === "disconnected") return ok(undefined);

    const refresh = this.box.open(connection.props.refreshTokenSealed);
    if (refresh.ok) {
      const revoked = await this.gateway.revoke(refresh.value);
      if (!revoked.ok) {
        logger.warn({ orgId }, "qbo.revoke_failed_disconnecting_locally");
      }
    } else {
      // Can't unseal (key changed) — nothing to revoke, but the local row must still be cleared.
      logger.warn({ orgId }, "qbo.revoke_skipped_unseal_failed");
    }

    await this.runInTenant((repo) => repo.save(connection.disconnect(this.clock.now())));
    logger.info({ orgId }, "qbo.disconnected");
    return ok(undefined);
  }
}
