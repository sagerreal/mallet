import type { Clock, Result, AppError } from "@mallet/shared/types";
import { ok, err, notFound, unauthorized, externalService } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { SecretBox } from "@mallet/platform/crypto/secret-box";
import type { QboConnectionRepository } from "../domain/qbo-connection-repository";
import type { QboOauthGateway } from "../domain/qbo-oauth-gateway";

export interface FreshAccess {
  readonly accessToken: string;
  readonly realmId: string;
}

/**
 * The single entry point every QuickBooks API call goes through to get a usable access token.
 *
 * This is the most failure-prone part of the integration, so the ordering is deliberate:
 *
 *  1. Read the connection UNDER A ROW LOCK. Two concurrent callers both seeing a stale access
 *     token would otherwise both refresh; Intuit retires the refresh token on first use, so the
 *     second exchange fails AND whichever write lands last can overwrite a good token with a dead
 *     one. The lock makes the loser wait, then re-read the winner's fresh token.
 *  2. Refresh only when actually needed (with a skew buffer, so a token never dies mid-flight).
 *  3. PERSIST BOTH tokens before returning. Intuit rotates the refresh token on every exchange —
 *     returning the new access token without saving the new refresh token would work exactly once
 *     and then lock the shop out permanently.
 *
 * The caller must run this inside the same transaction as its own work for the lock to mean
 * anything — that is the norm here (ownerOrOffice already wraps resolvers in withTenant).
 *
 * DELIBERATE EXCEPTION to the "no external call inside an open tenant tx" rule that
 * CompleteQboConnect/DisconnectQbo follow. Serialising refresh REQUIRES holding the row lock
 * across the exchange — releasing it first is precisely the race that strands a tenant on a dead
 * refresh token. The cost is bounded and small: the lock covers ONE org's ONE row, and the gateway
 * caps the call at 15s, so the worst case is that org's next QBO operation waiting behind a
 * timeout. A permanent lock-out is a far worse trade than a bounded wait.
 */
export class EnsureFreshAccessToken {
  constructor(
    private readonly connections: QboConnectionRepository,
    private readonly gateway: QboOauthGateway,
    private readonly box: SecretBox,
    private readonly clock: Clock,
  ) {}

  async exec(orgId: string): Promise<Result<FreshAccess, AppError>> {
    const connection = await this.connections.getForUpdate();
    if (!connection) {
      return err(notFound("QuickBooks is not connected"));
    }

    const now = this.clock.now();
    const { realmId } = connection.props;

    // Refresh token lapsed or the shop disconnected — no amount of retrying fixes this.
    if (!connection.isUsable(now)) {
      return err(unauthorized("QuickBooks needs to be reconnected"));
    }

    if (!connection.needsRefresh(now)) {
      const opened = this.box.open(connection.props.accessTokenSealed);
      if (!opened.ok) {
        // The stored ciphertext can't be decrypted — almost certainly the encryption key changed.
        // Treat it as needing reconnection rather than silently failing every later call.
        logger.error({ orgId }, "qbo.token.unseal_failed");
        await this.connections.save(connection.markNeedsReauth(now));
        return err(unauthorized("QuickBooks credentials could not be read; reconnect required"));
      }
      return ok({ accessToken: opened.value, realmId });
    }

    const currentRefresh = this.box.open(connection.props.refreshTokenSealed);
    if (!currentRefresh.ok) {
      logger.error({ orgId }, "qbo.refresh_token.unseal_failed");
      await this.connections.save(connection.markNeedsReauth(now));
      return err(unauthorized("QuickBooks credentials could not be read; reconnect required"));
    }

    const refreshed = await this.gateway.refresh(currentRefresh.value);
    if (!refreshed.ok) {
      // Intuit rejecting the credentials is terminal until the shop reconnects; flag it so the
      // Settings card can say so instead of every sync failing with a vague error forever.
      if (refreshed.error.kind === "unauthorized") {
        await this.connections.save(connection.markNeedsReauth(now));
        logger.warn({ orgId }, "qbo.refresh.rejected_marking_reauth");
        return err(refreshed.error);
      }
      // A transient failure (5xx/timeout) leaves the connection ALONE — the existing refresh token
      // is still valid and the next attempt should use it.
      logger.warn({ orgId }, "qbo.refresh.transient_failure");
      return err(refreshed.error);
    }

    const tokens = refreshed.value;
    const next = connection.withRefreshedTokens(
      {
        accessTokenSealed: this.box.seal(tokens.accessToken),
        refreshTokenSealed: this.box.seal(tokens.refreshToken),
        accessExpiresAt: tokens.accessExpiresAt,
        refreshExpiresAt: tokens.refreshExpiresAt,
      },
      now,
    );

    // Persist BEFORE returning. If this throws, the caller gets an error and retries with the old
    // (still-valid-until-first-use) token rather than proceeding on a token we failed to record.
    try {
      await this.connections.save(next);
    } catch (error) {
      logger.error(
        { orgId, err: error instanceof Error ? error.message : String(error) },
        "qbo.refresh.persist_failed",
      );
      return err(
        externalService("quickbooks", "Could not save refreshed QuickBooks credentials", true),
      );
    }

    logger.info({ orgId }, "qbo.token.refreshed");
    return ok({ accessToken: tokens.accessToken, realmId });
  }
}
