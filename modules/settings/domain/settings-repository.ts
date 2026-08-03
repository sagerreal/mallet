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

/** 'hourly' = billed per hour (hours × rate); 'flat_fee' = a fixed charge (diagnostic/trip fee). */
export type LaborRateKind = "hourly" | "flat_fee";

export interface LaborRate {
  readonly id: string;
  readonly label: string;
  /** Rate in cents — per hour when kind is 'hourly', or a flat charge when kind is 'flat_fee'. */
  readonly rateCentsPerHour: number;
  readonly kind: LaborRateKind;
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

  /**
   * Focused read of the org's tech price-visibility flag — used by the tech-facing
   * field surface to redact money server-side. Returns the schema default (true)
   * when the org_settings row does not exist yet (no lazy create on this path).
   */
  getTechSeesPrice(): Promise<boolean>;

  /**
   * Focused read of the shop's IANA timezone — used wherever an instant has to become a
   * calendar day, above all the timesheet clock (a tech finishing at 21:00 Pacific belongs on
   * today's sheet, not tomorrow's, and the server runs in UTC). Returns the schema default when
   * the org_settings row does not exist yet, mirroring getTechSeesPrice (no lazy create).
   */
  getTimezone(): Promise<string>;

  /**
   * Side-effect-free existence check: does an org_settings row already exist for the current
   * tenant? Unlike getConfig, this never lazy-creates the row — callers that need to
   * distinguish "brand-new org, no settings yet" from "org has settings, possibly already
   * corrected by hand" (e.g. signup's one-time timezone derivation) must call this BEFORE
   * getConfig, since getConfig's lazy insert would make every org look pre-existing.
   */
  hasConfig(): Promise<boolean>;

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
    kind: LaborRateKind;
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
