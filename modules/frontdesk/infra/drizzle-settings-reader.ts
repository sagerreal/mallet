import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import type { OrgSettings } from "@mallet/settings";
import { DrizzleSettingsRepository, defaultBooking } from "@mallet/settings";
import type { SettingsReader } from "../domain/assistant";

/**
 * SettingsReader adapter over the existing settings read path. Delegates to
 * DrizzleSettingsRepository.getConfig — the same lazy-creating read the settings router uses —
 * so there is exactly ONE definition of how org settings load (no reimplementation).
 *
 * Constructed with a tenant-scoped tx (withTenant already set app.current_org_id); RLS scopes
 * every statement and getConfig ignores its orgId argument in favour of the bound this.orgId,
 * so the two are always consistent. One query path — safe for the 7.5s Vapi budget.
 */
export class DrizzleSettingsReader implements SettingsReader {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async getByOrg(orgId: OrgId): Promise<OrgSettings | null> {
    const repo = new DrizzleSettingsRepository(this.tx, this.orgId);
    return repo.getConfig(orgId, defaultBooking);
  }
}
