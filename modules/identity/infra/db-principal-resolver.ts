import { sql } from "drizzle-orm";
import type { Database } from "@mallet/shared/db/client";
import { asUserId, asOrgId } from "@mallet/shared/types";
import type { PrincipalResolver } from "../domain/auth-provider";
import type { Principal } from "../domain/principal";
import { isRole } from "../domain/principal";

interface PrincipalRow {
  readonly user_id: string;
  readonly org_id: string;
  readonly role: string;
}

// Resolves a verified Supabase auth id to its org membership by calling the SECURITY DEFINER
// function app_resolve_principal — so this runs on the least-privilege mallet_app connection
// yet can read the cross-tenant users table through that one narrow, audited seam.
export class DbPrincipalResolver implements PrincipalResolver {
  constructor(private readonly db: Database) {}

  async resolve(authUserId: string): Promise<Principal | null> {
    const rows = (await this.db.execute(
      sql`select user_id, org_id, role from public.app_resolve_principal(${authUserId})`,
    )) as unknown as PrincipalRow[];

    const row = rows[0];
    if (!row) return null;
    if (!isRole(row.role)) {
      throw new Error(`users.role holds an unknown value: ${row.role}`);
    }
    return {
      userId: asUserId(row.user_id),
      orgId: asOrgId(row.org_id),
      role: row.role,
    };
  }
}
