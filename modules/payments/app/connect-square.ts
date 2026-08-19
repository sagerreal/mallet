import type { Result, AppError, Clock } from "@mallet/shared/types";
import { ok, err, validation, externalService } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { SecretBox } from "@mallet/platform/crypto/secret-box";
import type { SquareOauthGateway } from "../domain/square-oauth-gateway";
import { SQUARE_SCOPES } from "../domain/square-oauth-gateway";
import { signSquareOauthState } from "../domain/square-oauth-state";
import type { SquareConnectionRepository } from "../domain/square-connection-repository";

/** How long a consent redirect stays valid. Long enough to read Square's screen, short enough
 *  that a leaked URL is worthless by the time anyone finds it. */
const STATE_TTL_MS = 10 * 60_000;

/** Leg 1: where to send the shop owner. */
export class StartSquareConnect {
  constructor(
    private readonly gateway: SquareOauthGateway,
    private readonly stateSecret: string | undefined,
    private readonly clock: Clock,
  ) {}

  exec(orgId: string): Result<{ url: string }, AppError> {
    if (!this.gateway.isConfigured() || !this.stateSecret) {
      // Fail closed and say so plainly. A connect button that silently does nothing is worse
      // than one that explains the server is not set up for Square.
      return err(externalService("square", "Square isn't set up on this server yet", false));
    }
    const state = signSquareOauthState(this.stateSecret, orgId, new Date(this.clock.now().getTime() + STATE_TTL_MS));
    return ok({ url: this.gateway.authorizeUrl(state) });
  }
}

export interface CompleteSquareConnectCmd {
  readonly code: string;
  readonly userId: string | null;
}

export type TenantRunner = <T>(fn: (repo: SquareConnectionRepository) => Promise<T>) => Promise<T>;

/**
 * Leg 2: trade the code for tokens and store them sealed.
 *
 * The org is NOT taken from the request — the callback carries no auth header. It comes from the
 * signed state, verified by the route before this runs.
 */
export class CompleteSquareConnect {
  constructor(
    private readonly run: TenantRunner,
    private readonly gateway: SquareOauthGateway,
    private readonly secretBox: SecretBox,
  ) {}

  async exec(cmd: CompleteSquareConnectCmd, orgId: string): Promise<Result<{ merchantId: string }, AppError>> {
    if (cmd.code.trim().length === 0) return err(validation("missing authorization code", "code"));

    const tokens = await this.gateway.exchangeCode(cmd.code);
    if (!tokens.ok) return err(tokens.error);

    // Sealed BEFORE they touch the repository. Between these two lines is the only place in the
    // system where a live Square access token exists in plaintext.
    const accessSealed = this.secretBox.seal(tokens.value.accessToken);
    const refreshSealed = this.secretBox.seal(tokens.value.refreshToken);

    const saved = await this.run((repo) =>
      repo.upsert({
        merchantId: tokens.value.merchantId,
        accessTokenSealed: accessSealed,
        refreshTokenSealed: refreshSealed,
        accessExpiresAt: tokens.value.accessExpiresAt,
        // What we ASKED for. Square returns the granted set on the token response for some flows
        // and not others, so this records the request; a scope actually missing shows up as a
        // permission error at charge time, which is why the fee scope is asserted in tests here
        // rather than discovered there.
        scopes: SQUARE_SCOPES.join(" "),
        connectedByUserId: cmd.userId,
      }),
    );
    if (!saved.ok) return err(saved.error);

    // merchantId is an identifier, not a secret — safe to log, and the one thing worth having
    // when a shop asks which Square account they connected.
    logger.info({ orgId, merchantId: tokens.value.merchantId }, "square.connected");
    return ok({ merchantId: tokens.value.merchantId });
  }
}

/** Disconnect locally, then best-effort revoke at Square. */
export class DisconnectSquare {
  constructor(
    private readonly run: TenantRunner,
    private readonly gateway: SquareOauthGateway,
    private readonly secretBox: SecretBox,
  ) {}

  async exec(orgId: string): Promise<Result<{ ok: true }, AppError>> {
    const live = await this.run((repo) => repo.findLive());
    if (!live) return err(validation("no Square connection to disconnect", "connection"));

    const affected = await this.run((repo) => repo.disconnect());
    if (affected === 0) return err(validation("no Square connection to disconnect", "connection"));

    // LOCAL FIRST, revoke second, and a revoke failure does NOT fail the operation: the shop asked
    // to disconnect, and leaving them connected because Square was unreachable would be the wrong
    // answer. The token is already unusable to us — the row is gone.
    const opened = this.secretBox.open(live.accessTokenSealed);
    if (opened.ok) {
      const revoked = await this.gateway.revoke(opened.value);
      if (!revoked.ok) logger.warn({ orgId }, "square.disconnect.revoke_failed");
    }

    logger.info({ orgId }, "square.disconnected");
    return ok({ ok: true });
  }
}
