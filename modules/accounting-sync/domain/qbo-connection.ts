import type { Result, ValidationError } from "@mallet/shared/types";
import { ok, err, validation } from "@mallet/shared/types";

// One QuickBooks Online connection per org.
//
// The whole reason this is a domain object rather than a row: Intuit's token lifecycle has two
// clocks and getting either wrong breaks the tenant.
//   - the ACCESS token dies after ~60 minutes. Stale access is normal and recoverable — refresh it.
//   - the REFRESH token is long-lived BUT its value ROTATES every 24-26 hours. Every exchange
//     returns a new one, and the old one dies. Persist the new value on every single refresh or
//     the shop is locked out and has to reconnect by hand.
// `needsRefresh` / `isRefreshExpired` / `isUsable` exist so no caller has to re-derive that.

export type QboConnectionStatus = "active" | "needs_reauth" | "disconnected";

const STATUSES: readonly QboConnectionStatus[] = ["active", "needs_reauth", "disconnected"];
const isStatus = (v: string): v is QboConnectionStatus =>
  STATUSES.includes(v as QboConnectionStatus);

// Refresh this long BEFORE the access token actually expires. Covers clock skew between us and
// Intuit plus the round-trip of the call we're about to make, so a request never departs holding a
// token that dies in flight.
export const ACCESS_TOKEN_SKEW_MS = 5 * 60_000;

export interface QboConnectionProps {
  readonly id: string;
  readonly orgId: string;
  /** Intuit's company id. Every API path is scoped by it. */
  readonly realmId: string;
  /** Sealed by platform/crypto SecretBox — never plaintext at rest or in logs. */
  readonly accessTokenSealed: string;
  readonly refreshTokenSealed: string;
  readonly accessExpiresAt: Date;
  readonly refreshExpiresAt: Date;
  readonly status: QboConnectionStatus;
  readonly connectedByUserId: string | null;
  readonly lastSyncAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly disconnectedAt: Date | null;
}

/** The four fields a token exchange or refresh returns. */
export interface RefreshedTokens {
  readonly accessTokenSealed: string;
  readonly refreshTokenSealed: string;
  readonly accessExpiresAt: Date;
  readonly refreshExpiresAt: Date;
}

export class QboConnection {
  private constructor(private readonly p: QboConnectionProps) {}

  static create(props: QboConnectionProps): Result<QboConnection, ValidationError> {
    if (!props.orgId) return err(validation("orgId is required", "orgId"));
    if (!props.realmId) return err(validation("realmId is required", "realmId"));
    if (!isStatus(props.status)) {
      return err(validation(`invalid status: "${props.status}"`, "status"));
    }
    // A disconnected row deliberately holds no tokens — that's the point of disconnecting.
    if (props.status !== "disconnected") {
      if (!props.accessTokenSealed) {
        return err(validation("accessTokenSealed is required", "accessTokenSealed"));
      }
      if (!props.refreshTokenSealed) {
        return err(validation("refreshTokenSealed is required", "refreshTokenSealed"));
      }
    }
    return ok(new QboConnection(props));
  }

  private next(patch: Partial<QboConnectionProps>): QboConnection {
    return new QboConnection({ ...this.p, ...patch });
  }

  /** True when the access token is expired or close enough that we should refresh first. */
  needsRefresh(now: Date): boolean {
    return this.p.accessExpiresAt.getTime() - ACCESS_TOKEN_SKEW_MS <= now.getTime();
  }

  /** True when refreshing is no longer possible — only the shop reconnecting fixes this. */
  isRefreshExpired(now: Date): boolean {
    return this.p.refreshExpiresAt.getTime() <= now.getTime();
  }

  /**
   * Can we still make calls for this org (possibly after a refresh)? A stale ACCESS token is not
   * a reason to say no — that's the ordinary path.
   */
  isUsable(now: Date): boolean {
    return this.p.status !== "disconnected" && !this.isRefreshExpired(now);
  }

  /**
   * Adopt the result of a token exchange/refresh. Takes BOTH tokens because Intuit rotates the
   * refresh token — writing back only the access token is the classic way to lock a tenant out.
   * A successful refresh also clears needs_reauth: whatever was wrong evidently isn't anymore.
   */
  withRefreshedTokens(tokens: RefreshedTokens, now: Date): QboConnection {
    return this.next({
      accessTokenSealed: tokens.accessTokenSealed,
      refreshTokenSealed: tokens.refreshTokenSealed,
      accessExpiresAt: tokens.accessExpiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt,
      status: "active",
      updatedAt: now,
    });
  }

  /** Intuit rejected our credentials. Keep the row (and the realm) so the UI can prompt a reconnect. */
  markNeedsReauth(now: Date): QboConnection {
    return this.next({ status: "needs_reauth", updatedAt: now });
  }

  /** The shop disconnected. Drop both tokens so nothing can be replayed from our side. */
  disconnect(now: Date): QboConnection {
    return this.next({
      status: "disconnected",
      accessTokenSealed: "",
      refreshTokenSealed: "",
      disconnectedAt: now,
      updatedAt: now,
    });
  }

  withLastSyncAt(now: Date): QboConnection {
    return this.next({ lastSyncAt: now, updatedAt: now });
  }

  get props(): QboConnectionProps {
    return this.p;
  }
}
