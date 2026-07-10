import type { Result, AppError, Clock } from "@mallet/shared/types";
import { ok } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { OrgSettings } from "../domain/org-settings";
import type { OrgSettingsConfigPort } from "../domain/org-settings-repository";

export interface UpdateBrandCommand {
  readonly name?: string;
  readonly tagline?: string | null;
  readonly site?: string | null;
  readonly color?: string | null;
  readonly logoUrl?: string | null;
  readonly initials?: string | null;
}

/**
 * Narrow port: brand NAME lives on orgs.name, not org_settings. The Drizzle impl
 * (Task 5) updates orgs in the same org-scoped tx provided by the router's
 * `withTenant` wrapper — both writes commit or roll back atomically. The app layer
 * stays infra-free by depending only on this interface.
 */
export interface OrgNameWriter {
  setName(orgId: string, name: string, now: Date): Promise<void>;
}

/**
 * Updates an org's brand identity: brand_* fields in org_settings (via
 * OrgSettingsConfigPort) and the display name in orgs.name (via OrgNameWriter).
 *
 * Tx-atomicity: both writes execute inside the router's `withTenant` transaction.
 * The use-case calls them sequentially; the enclosing Postgres tx commits or
 * rolls back them together without any coordination logic here.
 */
export class UpdateBrandUseCase {
  constructor(
    private readonly settings: OrgSettingsConfigPort,
    private readonly orgNames: OrgNameWriter,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: UpdateBrandCommand, orgId: string): Promise<Result<OrgSettings, AppError>> {
    const current = await this.settings.getConfig(orgId, OrgSettings.defaultBooking);
    const now = this.clock.now();

    const patched = current.patchBrand(
      {
        name: cmd.name,
        tagline: cmd.tagline,
        site: cmd.site,
        color: cmd.color,
        logoUrl: cmd.logoUrl,
        initials: cmd.initials,
      },
      now,
    );
    if (!patched.ok) return patched;

    await this.settings.saveConfig(patched.value);

    // Only touch orgs.name when the caller explicitly provided a name.
    // An omitted name leaves orgs.name unchanged; a blank name is rejected
    // by patchBrand above before we reach this point.
    if (cmd.name !== undefined) {
      await this.orgNames.setName(orgId, patched.value.props.brandName, now);
    }

    logger.info({ orgId }, "brand.updated");
    return ok(patched.value);
  }
}
