import { sql } from "drizzle-orm";
import type { Database } from "@mallet/shared/db/client";
import { withConnectionRetry } from "@mallet/shared/db/connection-retry";

export interface SignupInput {
  readonly authUserId: string;
  readonly email: string;
  readonly orgName: string;
  readonly name: string | null;
}

export interface ProvisionedOrg {
  readonly orgId: string;
  readonly role: string;
}

// The signup provisioning port: resolves/creates the org for a verified-but-unmapped auth user via
// the SECURITY DEFINER app_signup_create_org (idempotent) on the least-privilege connection.
// withConnectionRetry handles the transient 28P01 "password authentication failed" that Supabase's
// Supavisor pooler occasionally raises on first cold-connection establishment (same pattern as
// withTenant in shared/db/tx.ts).
export class SignupStore {
  constructor(private readonly db: Database) {}

  async createOrgForUser(input: SignupInput): Promise<ProvisionedOrg> {
    const rows = await withConnectionRetry(() =>
      this.db.execute(
        sql`select org_id, role from public.app_signup_create_org(${input.authUserId}, ${input.email}, ${input.orgName}, ${input.name})`,
      ),
    ) as unknown as { org_id: string; role: string }[];
    const row = rows[0];
    if (!row) throw new Error("app_signup_create_org returned no row");
    return { orgId: row.org_id, role: row.role };
  }
}
