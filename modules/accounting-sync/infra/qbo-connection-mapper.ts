import { QboConnection, type QboConnectionStatus } from "../domain/qbo-connection";

// DTO≠domain boundary for qbo_connections. The token columns cross this boundary SEALED in both
// directions — the mapper never encrypts or decrypts, it just moves opaque strings. Unsealing is
// the gateway's job, at the moment of use, so plaintext never sits in a repository or a row object.

export interface QboConnectionRow {
  id: string;
  orgId: string;
  realmId: string;
  accessTokenSealed: string;
  refreshTokenSealed: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  status: string;
  connectedByUserId: string | null;
  lastSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  disconnectedAt: Date | null;
}

export const toDomain = (row: QboConnectionRow): QboConnection => {
  const res = QboConnection.create({
    id: row.id,
    orgId: row.orgId,
    realmId: row.realmId,
    accessTokenSealed: row.accessTokenSealed,
    refreshTokenSealed: row.refreshTokenSealed,
    accessExpiresAt: row.accessExpiresAt,
    refreshExpiresAt: row.refreshExpiresAt,
    status: row.status as QboConnectionStatus,
    connectedByUserId: row.connectedByUserId,
    lastSyncAt: row.lastSyncAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    disconnectedAt: row.disconnectedAt,
  });
  // A row that fails domain invariants means the DB disagrees with the code — unrecoverable here,
  // and silently returning null would hide it. The message names the org, never a token.
  if (!res.ok) {
    throw new Error(`corrupt qbo_connections row for org ${row.orgId}: ${res.error.message}`);
  }
  return res.value;
};

export const toRow = (connection: QboConnection): QboConnectionRow => {
  const p = connection.props;
  return {
    id: p.id,
    orgId: p.orgId,
    realmId: p.realmId,
    accessTokenSealed: p.accessTokenSealed,
    refreshTokenSealed: p.refreshTokenSealed,
    accessExpiresAt: p.accessExpiresAt,
    refreshExpiresAt: p.refreshExpiresAt,
    status: p.status,
    connectedByUserId: p.connectedByUserId,
    lastSyncAt: p.lastSyncAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    disconnectedAt: p.disconnectedAt,
  };
};
