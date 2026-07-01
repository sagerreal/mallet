import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "@mallet/shared/db/client";
import { asUserId, asOrgId } from "@mallet/shared/types";
import type { Principal } from "../domain/principal";
import { isRole } from "../domain/principal";
import type { ApiKeyVerifier } from "../domain/auth-provider";

const KEY_PREFIX = "mallet_sk_";

// A static per-tenant API key = `mallet_sk_<48 hex>`. Returns the raw key (show ONCE) + its hash
// (what we store). The DB never sees the raw key.
export const generateApiKey = (): { raw: string; hash: string } => {
  const raw = `${KEY_PREFIX}${randomBytes(24).toString("hex")}`;
  return { raw, hash: hashApiKey(raw) };
};

export const hashApiKey = (raw: string): string => createHash("sha256").update(raw).digest("hex");

interface KeyRow {
  readonly id: string;
  readonly org_id: string;
  readonly role: string;
}

// Resolves a presented Bearer key to a Principal for the remote MCP server. The Supabase token path
// can't be reused (it only accepts short-lived Supabase JWTs an external host can't mint), so this
// is a distinct verifier: hash the key, look it up (unrevoked) via the SECURITY DEFINER
// app_resolve_api_key on the least-privilege connection. The key's own id is the Principal userId
// (a stable, traceable identity for the key); orgId + role come from the key row — never from input.
export class ApiKeyAuthenticator implements ApiKeyVerifier {
  constructor(private readonly db: Database) {}

  async authenticate(bearerToken: string): Promise<Principal | null> {
    if (!bearerToken.startsWith(KEY_PREFIX)) return null;
    const rows = (await this.db.execute(
      sql`select id, org_id, role from public.app_resolve_api_key(${hashApiKey(bearerToken)})`,
    )) as unknown as KeyRow[];
    const row = rows[0];
    if (!row) return null;
    if (!isRole(row.role)) throw new Error(`api_keys.role holds an unknown value: ${row.role}`);
    return { userId: asUserId(row.id), orgId: asOrgId(row.org_id), role: row.role };
  }
}

export const createApiKeyAuthenticator = (db: Database): ApiKeyAuthenticator => new ApiKeyAuthenticator(db);
