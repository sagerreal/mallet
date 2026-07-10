import type { SettingsRepository } from "./settings-repository";

/**
 * Narrow port for brand-scoped settings access used by UpdateBrandUseCase.
 *
 * Defined as a Pick of SettingsRepository so the existing DrizzleSettingsRepository
 * (Task 5) structurally satisfies it with ZERO new methods — no parallel hierarchy,
 * no DRY violation. ISP without duplication.
 *
 * Note on tx-atomicity: both writes (saveConfig + OrgNameWriter.setName) run inside
 * the org-scoped Postgres transaction provided by the router's `withTenant` wrapper.
 * The use-case calls them sequentially; the enclosing tx commits or rolls back both
 * together — no two-phase commit is needed within a single Postgres tx.
 */
export type OrgSettingsConfigPort = Pick<SettingsRepository, "getConfig" | "saveConfig">;
