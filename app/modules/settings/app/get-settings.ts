import type { Result, AppError } from "@mallet/shared/types";
import { ok } from "@mallet/shared/types";
import type { OrgSettings } from "../domain/org-settings";
import type {
  SettingsRepository, PricebookItem, LaborRate, JobTerm, LeadSource,
} from "../domain/settings-repository";
import { defaultBooking } from "./default-booking";

// Snapshot of all settings data returned in a single read.
export interface SettingsSnapshot {
  readonly config: OrgSettings;
  readonly pricebook: PricebookItem[];
  readonly laborRates: LaborRate[];
  readonly terms: JobTerm[];
  readonly sources: LeadSource[];
}

// Read use-case: fetch (lazily creating) the org_settings row + all four collections in one call.
// Idempotent — calling twice yields the same config row (the repo's getConfig upserts on first access).
export class GetSettingsUseCase {
  constructor(private readonly repo: SettingsRepository) {}

  async exec(orgId: string): Promise<Result<SettingsSnapshot, AppError>> {
    const config = await this.repo.getConfig(orgId, defaultBooking);
    const [pricebook, laborRates, terms, sources] = await Promise.all([
      this.repo.listPricebook(),
      this.repo.listLaborRates(),
      this.repo.listTerms(),
      this.repo.listSources(),
    ]);
    return ok({ config, pricebook, laborRates, terms, sources });
  }
}
