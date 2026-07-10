import type { Result, AppError, Clock } from "@mallet/shared/types";
import { ok } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { OrgSettings, OrgSettingsProps } from "../domain/org-settings";
import type { SettingsRepository } from "../domain/settings-repository";
import { defaultBooking } from "./default-booking";

// Fields the caller may change — orgId and timestamps are server-owned and not patchable.
export type UpdateConfigCommand = Partial<
  Omit<OrgSettingsProps, "orgId" | "createdAt" | "updatedAt">
>;

// Patch the scalar/jsonb config for an org. Lazily materialises the row first so an org that has
// never opened Settings can still save (idempotent upsert via repo.getConfig).
export class UpdateConfigUseCase {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: UpdateConfigCommand, orgId: string): Promise<Result<OrgSettings, AppError>> {
    const current = await this.repo.getConfig(orgId, defaultBooking);
    const patched = current.patch(cmd, this.clock.now());
    if (!patched.ok) return patched;
    await this.repo.saveConfig(patched.value);
    logger.info({ orgId }, "settings.config.updated");
    return ok(patched.value);
  }
}
