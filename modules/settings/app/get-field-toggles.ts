import type { Result, AppError } from "@mallet/shared/types";
import { ok } from "@mallet/shared/types";
import type { SettingsRepository } from "../domain/settings-repository";
import { defaultBooking } from "./default-booking";

/**
 * The org capability flags the FIELD surface needs, and nothing else.
 *
 * WHY THIS EXISTS SEPARATELY FROM GetSettingsUseCase. `v1.settings.get` is `ownerOrOffice` and
 * returns the whole configuration — booking rules, hours, service area, branding, labor rates,
 * lead sources, Stripe Connect status. A technician has no business holding any of that. But
 * `SettingsHydrator` is the only writer of `store.toggles`, and the field layout gates it behind
 * `!isTech`, so for a tech `measurementEstimating` could never be anything but its placeholder —
 * and the tech Quote tab's "Scan a room" row, the one surface the field scanner is actually FOR,
 * could never render for the role it was built for.
 *
 * So: one narrow read, `anyRole`, returning ONE boolean. It is a capability flag about the
 * SHOP's trade — the same fact a tech learns by looking at the van — and it carries no prices,
 * no customer data, no credentials and no office configuration.
 */
export interface FieldToggles {
  readonly measurementEstimating: boolean;
}

export class GetFieldTogglesUseCase {
  constructor(private readonly repo: SettingsRepository) {}

  async exec(orgId: string): Promise<Result<FieldToggles, AppError>> {
    const config = await this.repo.getConfig(orgId, defaultBooking);
    return ok({ measurementEstimating: config.props.measurementEstimating });
  }
}
