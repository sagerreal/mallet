import type { OrgSettings } from "./org-settings";

/**
 * Narrow port for brand-scoped settings access. Used by UpdateBrandUseCase so the
 * app layer stays infra-free. Task 5's Drizzle adapter implements this alongside the
 * broader SettingsRepository.
 *
 * Note on tx-atomicity: both `save` and OrgNameWriter.setName run inside the
 * org-scoped transaction supplied by the router's `withTenant` wrapper. The
 * use-case calls both sequentially; the enclosing tx commits or rolls back them
 * together — no two-phase commit is needed within a single Postgres tx.
 */
export interface OrgSettingsRepository {
  /**
   * Returns the org's settings row, lazily creating it with sane defaults on first access.
   * Idempotent — safe to call multiple times for the same org.
   */
  getOrCreate(orgId: string): Promise<OrgSettings>;

  /** Persists a mutated OrgSettings (brand fields) back to org_settings. Upsert-safe. */
  save(settings: OrgSettings): Promise<void>;
}
