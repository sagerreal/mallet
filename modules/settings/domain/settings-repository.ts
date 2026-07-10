import type { OrgSettings, BookingCfg } from "./org-settings";

// --- Collection value types ----------------------------------------------
// Plain row shapes — not full aggregates (no per-row invariants beyond a non-empty label,
// which is enforced in the use-case layer). All money in cents; positions are integers.

export interface PricebookItem {
  readonly id: string;
  readonly label: string;
  /** Customer-facing unit price in cents. */
  readonly unitPriceCents: number;
  /** Internal material/labor cost in cents (techs never see this). */
  readonly costCents: number;
  readonly position: number;
}

export interface LaborRate {
  readonly id: string;
  readonly label: string;
  /** Rate in cents per hour. */
  readonly rateCentsPerHour: number;
  readonly position: number;
}

export interface JobTerm {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly position: number;
}

export interface LeadSource {
  readonly id: string;
  readonly label: string;
  readonly position: number;
}

// --- Port ----------------------------------------------------------------

/**
 * Settings repository port — the only data-access surface for the settings module.
 * The org is NEVER passed as a parameter: it is implicit in the org-scoped transaction
 * the repository is constructed with, so callers physically cannot address another
 * tenant's data.
 *
 * Naming: list/create/save/archive per collection mirrors the companies pattern.
 * save methods return the number of rows affected (0 = not found / already archived).
 * archive methods soft-delete via deleted_at.
 */
export interface SettingsRepository {
  // --- org_settings (one row per org) ------------------------------------

  /**
   * Returns the org's config, lazily creating the row on first access using the
   * complete BookingCfg produced by the `defaults` factory. The booking column is
   * NOT NULL in the DB, so `defaults` must return a full, valid BookingCfg.
   * Use OrgSettings.defaultBooking() as the factory argument.
   */
  getConfig(orgId: string, defaults: () => BookingCfg): Promise<OrgSettings>;

  /** Persists a mutated OrgSettings back to org_settings. Upsert-safe (idempotent). */
  saveConfig(settings: OrgSettings): Promise<void>;

  // --- pricebook_items ---------------------------------------------------

  /**
   * Returns all non-archived pricebook items for the current tenant.
   * Implicitly scoped to the org — the Drizzle adapter runs under `withTenant`,
   * so no `orgId` argument is needed or accepted here.
   */
  listPricebook(): Promise<PricebookItem[]>;

  createPricebook(input: {
    id: string;
    orgId: string;
    label: string;
    unitPriceCents: number;
    costCents: number;
    position: number;
  }): Promise<PricebookItem>;

  /** Updates a pricebook item. Returns rows affected (0 = not found). */
  savePricebook(item: PricebookItem, updatedAt: Date): Promise<number>;

  /** Soft-deletes a pricebook item. Returns rows affected (0 = not found). */
  archivePricebook(id: string, now: Date): Promise<number>;

  // --- labor_rates -------------------------------------------------------

  /**
   * Returns all non-archived labor rates for the current tenant.
   * Implicitly scoped to the org — the Drizzle adapter runs under `withTenant`,
   * so no `orgId` argument is needed or accepted here.
   */
  listLaborRates(): Promise<LaborRate[]>;

  createLaborRate(input: {
    id: string;
    orgId: string;
    label: string;
    rateCentsPerHour: number;
    position: number;
  }): Promise<LaborRate>;

  /** Updates a labor rate. Returns rows affected (0 = not found). */
  saveLaborRate(rate: LaborRate, updatedAt: Date): Promise<number>;

  /**
   * Returns the count of active (non-archived) labor rates.
   * Used by the archive use-case to enforce the "≥1 active rate" invariant.
   */
  countActiveLaborRates(): Promise<number>;

  /** Soft-deletes a labor rate. Returns rows affected (0 = not found). */
  archiveLaborRate(id: string, now: Date): Promise<number>;

  // --- job_terms ---------------------------------------------------------

  /**
   * Returns all non-archived job terms for the current tenant.
   * Implicitly scoped to the org — the Drizzle adapter runs under `withTenant`,
   * so no `orgId` argument is needed or accepted here.
   */
  listTerms(): Promise<JobTerm[]>;

  createTerm(input: {
    id: string;
    orgId: string;
    title: string;
    body: string;
    position: number;
  }): Promise<JobTerm>;

  /** Updates a job term. Returns rows affected (0 = not found). */
  saveTerm(term: JobTerm, updatedAt: Date): Promise<number>;

  /** Soft-deletes a job term. Returns rows affected (0 = not found). */
  archiveTerm(id: string, now: Date): Promise<number>;

  // --- lead_sources ------------------------------------------------------

  /**
   * Returns all non-archived lead sources for the current tenant.
   * Implicitly scoped to the org — the Drizzle adapter runs under `withTenant`,
   * so no `orgId` argument is needed or accepted here.
   */
  listSources(): Promise<LeadSource[]>;

  createSource(input: {
    id: string;
    orgId: string;
    label: string;
    position: number;
  }): Promise<LeadSource>;

  /** Updates a lead source. Returns rows affected (0 = not found). */
  saveSource(source: LeadSource, updatedAt: Date): Promise<number>;

  /** Soft-deletes a lead source. Returns rows affected (0 = not found). */
  archiveSource(id: string, now: Date): Promise<number>;
}
