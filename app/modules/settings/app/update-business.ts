import type { Result, AppError, Clock } from "@mallet/shared/types";
import { ok } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { OrgSettings } from "../domain/org-settings";
import type { OrgSettingsConfigPort } from "../domain/org-settings-repository";

export interface UpdateBusinessCommand {
  readonly address?: string | null;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly license?: string | null;
}

/**
 * Updates the business identity printed on customer documents — address, phone, email and
 * licence number, all in org_settings.
 *
 * Simpler than UpdateBrandUseCase beside it because nothing here lives on the orgs table: the
 * business NAME is orgs.name (owned by updateBrand) and the website is brandSite. This use case
 * touches one row through one port, so it needs no second writer and no cross-table atomicity
 * argument. Sequenced through the router's `withTenant` transaction like every other write.
 */
export class UpdateBusinessUseCase {
  constructor(
    private readonly settings: OrgSettingsConfigPort,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: UpdateBusinessCommand, orgId: string): Promise<Result<OrgSettings, AppError>> {
    const current = await this.settings.getConfig(orgId, OrgSettings.defaultBooking);
    const now = this.clock.now();

    const patched = current.patchBusiness(
      {
        address: cmd.address,
        phone: cmd.phone,
        email: cmd.email,
        license: cmd.license,
      },
      now,
    );
    if (!patched.ok) return patched;

    await this.settings.saveConfig(patched.value);

    logger.info({ orgId }, "business.updated");
    return ok(patched.value);
  }
}
