import type { Result, AppError } from "@mallet/shared/types";

/** A stored connection, tokens still SEALED. Never widen this to expose plaintext. */
export interface SquareConnectionRow {
  readonly id: string;
  readonly merchantId: string;
  readonly locationId: string | null;
  readonly accessTokenSealed: string;
  readonly refreshTokenSealed: string;
  readonly accessExpiresAt: Date;
  readonly status: "active" | "disconnected" | "expired";
  readonly scopes: string;
}

export interface UpsertSquareConnectionCmd {
  readonly merchantId: string;
  readonly accessTokenSealed: string;
  readonly refreshTokenSealed: string;
  readonly accessExpiresAt: Date;
  readonly scopes: string;
  readonly connectedByUserId: string | null;
}

/**
 * The org is NEVER a parameter — it is implicit in the org-scoped transaction the repository is
 * constructed with, so a caller physically cannot address another tenant's connection. That
 * matters more here than anywhere else in the schema: this row authorises charges against a real
 * merchant account.
 */
export interface SquareConnectionRepository {
  /** The live connection for this org, or null. Tokens come back sealed. */
  findLive(): Promise<SquareConnectionRow | null>;

  /**
   * Create or replace this org's live connection. Reconnecting REPLACES rather than adding, which
   * is what the partial unique index enforces — a shop cannot end up with two live merchants and
   * no way to tell which one takes the money.
   */
  upsert(cmd: UpsertSquareConnectionCmd): Promise<Result<SquareConnectionRow, AppError>>;

  /** Soft-disconnect. Returns rows affected — 0 means there was nothing live to disconnect. */
  disconnect(): Promise<number>;

  /** Store the seller location payments are taken against. Returns rows affected. */
  setLocation(locationId: string): Promise<number>;

  /** Replace the token pair after a refresh. Square rotates BOTH, so both are written. */
  updateTokens(cmd: {
    readonly accessTokenSealed: string;
    readonly refreshTokenSealed: string;
    readonly accessExpiresAt: Date;
  }): Promise<number>;
}
