import type { Clock, Result, AppError } from "@mallet/shared/types";
import { ok, err, validation } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { SecretBox } from "@mallet/platform/crypto/secret-box";
import { QboConnection } from "../domain/qbo-connection";
import type { QboConnectionRepository } from "../domain/qbo-connection-repository";
import type { QboOauthGateway } from "../domain/qbo-oauth-gateway";

export interface CompleteQboConnectCommand {
  /** The ?code= Intuit sent to our callback. Single-use. */
  readonly code: string;
  /** The ?realmId= — which QuickBooks company the user picked. */
  readonly realmId: string;
  /** Who clicked connect, for the Settings card ("connected by …"). */
  readonly userId: string | null;
}

/**
 * Finish the OAuth dance: trade the code for tokens, seal them, store the connection.
 *
 * CSRF `state` is verified by the ROUTE before this runs — it is a transport concern (it lives in
 * a cookie) and keeping it there means this use-case is testable without a request object.
 *
 * Reconnecting overwrites the existing row (one connection per org). That is deliberate: the most
 * common reason to reconnect is a lapsed or rejected token, and the shop expects "connect again"
 * to fix it rather than to fail with "already connected".
 */
export class CompleteQboConnect {
  constructor(
    private readonly connections: QboConnectionRepository,
    private readonly gateway: QboOauthGateway,
    private readonly box: SecretBox,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CompleteQboConnectCommand, orgId: string): Promise<Result<QboConnection, AppError>> {
    if (!cmd.code) return err(validation("authorization code is required", "code"));
    if (!cmd.realmId) return err(validation("realmId is required", "realmId"));

    const exchanged = await this.gateway.exchangeCode(cmd.code);
    if (!exchanged.ok) return err(exchanged.error);

    const tokens = exchanged.value;
    const now = this.clock.now();
    const existing = await this.connections.get();

    const created = QboConnection.create({
      // Keep the original row identity across reconnects; the repository upserts on org_id.
      id: existing?.props.id ?? this.ids.newId(),
      orgId,
      realmId: cmd.realmId,
      accessTokenSealed: this.box.seal(tokens.accessToken),
      refreshTokenSealed: this.box.seal(tokens.refreshToken),
      accessExpiresAt: tokens.accessExpiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt,
      status: "active",
      connectedByUserId: cmd.userId,
      // A reconnect keeps the sync history; it is the same relationship, re-authorised.
      lastSyncAt: existing?.props.lastSyncAt ?? null,
      createdAt: existing?.props.createdAt ?? now,
      updatedAt: now,
      disconnectedAt: null,
    });
    if (!created.ok) return err(created.error);

    await this.connections.save(created.value);
    // realmId is not a secret (it's a company id, visible in QBO's own URLs); tokens never logged.
    logger.info({ orgId, realmId: cmd.realmId, reconnect: existing !== null }, "qbo.connected");

    return ok(created.value);
  }
}
