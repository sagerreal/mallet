import type { Clock } from "@mallet/shared/types";
import type { QboConnectionRepository } from "../domain/qbo-connection-repository";
import type { QboOauthGateway } from "../domain/qbo-oauth-gateway";

/**
 * What the Settings card renders. Deliberately a flat, secret-free shape — no token fields, sealed
 * or otherwise, so there is no path by which a credential reaches the client bundle.
 */
export interface QboStatus {
  /** False when the server has no client id/secret — the UI must say "not configured", not offer a button. */
  readonly configured: boolean;
  readonly state: "not_connected" | "connected" | "needs_reauth" | "disconnected";
  readonly realmId: string | null;
  readonly connectedByUserId: string | null;
  readonly lastSyncAt: Date | null;
  /** True when the refresh token has lapsed — reconnecting is the only fix. */
  readonly expired: boolean;
}

export class GetQboStatus {
  // The gateway is NULLABLE here on purpose: when QuickBooks is unconfigured on the server there
  // is nothing to inject, and the settings page must still render (reporting configured:false)
  // rather than 500.
  constructor(
    private readonly connections: QboConnectionRepository,
    private readonly gateway: QboOauthGateway | null,
    private readonly clock: Clock,
  ) {}

  async exec(): Promise<QboStatus> {
    const configured = this.gateway?.isConfigured() ?? false;
    const connection = await this.connections.get();

    if (!connection) {
      return {
        configured,
        state: "not_connected",
        realmId: null,
        connectedByUserId: null,
        lastSyncAt: null,
        expired: false,
      };
    }

    const now = this.clock.now();
    const p = connection.props;
    const expired = connection.isRefreshExpired(now);

    // A lapsed refresh token is functionally the same as a rejected one: the shop must reconnect.
    // Collapsing them here means the card has one "reconnect" story rather than two.
    const state =
      p.status === "disconnected"
        ? "disconnected"
        : p.status === "needs_reauth" || expired
          ? "needs_reauth"
          : "connected";

    return {
      configured,
      state,
      realmId: p.realmId,
      connectedByUserId: p.connectedByUserId,
      lastSyncAt: p.lastSyncAt,
      expired,
    };
  }
}
