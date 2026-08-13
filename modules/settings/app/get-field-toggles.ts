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
 * So: one narrow read, `anyRole`, returning the handful of facts the field surface needs. They are
 * facts about the SHOP — the same facts a tech learns by looking at the van or reading his own
 * paycheck — and they carry no prices, no customer data, no credentials and no office
 * configuration. Mostly booleans; the OVERTIME RULE is a structured value, because My hours
 * computes the technician's own overtime and cannot do it from a boolean. The shape widened on
 * purpose. The bar for what may ride here did not.
 *
 * `canText` is NOT read here: it lives in the a2p module (`isSmsA2pActive`), and the router
 * composes the two so "may this org send SMS" keeps exactly ONE definition. See the
 * `fieldToggles` procedure in settings-router.ts.
 */
export interface FieldToggles {
  readonly measurementEstimating: boolean;
  /** False = a sheet shop: no punch clock, the crew types their week. */
  readonly timesheetClock: boolean;
  /** May this technician hand-edit their own hours? False = corrections go through the office. */
  readonly techEditsTimes: boolean;
  /** The shop's overtime rule — My hours computes the technician's own overtime from it. */
  readonly overtime: {
    readonly weeklyThresholdMinutes: number;
    readonly dailyThresholdMinutes: number | null;
  };
}

export class GetFieldTogglesUseCase {
  constructor(private readonly repo: SettingsRepository) {}

  async exec(orgId: string): Promise<Result<FieldToggles, AppError>> {
    const config = await this.repo.getConfig(orgId, defaultBooking);
    return ok({
      measurementEstimating: config.props.measurementEstimating,
      timesheetClock: config.props.timesheetClock,
      techEditsTimes: config.props.techEditsTimes,
      overtime: {
        weeklyThresholdMinutes: config.props.otWeeklyThresholdMinutes,
        dailyThresholdMinutes: config.props.otDailyThresholdMinutes,
      },
    });
  }
}
