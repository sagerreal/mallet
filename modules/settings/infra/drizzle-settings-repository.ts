import { and, asc, count, eq, isNull } from "drizzle-orm";
import {
  orgs,
  orgSettings,
  pricebookItems,
  laborRates,
  jobTerms,
  leadSources,
} from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import type { OrgSettings, BookingCfg } from "../domain/org-settings";
import type {
  SettingsRepository,
  PricebookItem,
  LaborRate,
  LaborRateKind,
  JobTerm,
  LeadSource,
} from "../domain/settings-repository";
import type { OrgNameWriter } from "../app/update-brand";
import { toOrgSettings } from "./settings-mapper";

// Per-tenant list cap: these collections are small per-org (pilot scale). A hard cap protects
// against runaway data while a cursor pagination is not yet needed. Revisit if orgs grow large sets.
const LIST_LIMIT = 500;

// Maps a persisted labor_rates.kind value to the typed domain union. The column is a plain
// `text` with a DB check constraint (not a Postgres enum), so a legacy or otherwise unexpected
// value is defensively coerced to 'hourly' rather than thrown — reads must never break on data
// that predates this column (it was added with a NOT NULL default, but this stays defensive).
const toLaborRateKind = (kind: string): LaborRateKind => (kind === "flat_fee" ? "flat_fee" : "hourly");

/**
 * Real persistence. Constructed with a tenant-scoped tx (withTenant already set
 * `app.current_org_id`), so RLS appends `org_id = current_org_id()` to every statement.
 * `orgId` stamps inserts and guards explicit-tenant writes (defense-in-depth alongside RLS).
 *
 * The `orgId` argument to `getConfig` is redundant given DI but is required by the port
 * contract (keeps the port testable with mocks that lack a bound org). This implementation
 * ignores it and uses `this.orgId` so the two are always consistent.
 */
export class DrizzleSettingsRepository implements SettingsRepository, OrgNameWriter {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  // ── org_settings (one row per org) ────────────────────────────────────────

  async getConfig(_orgId: string, defaults: () => BookingCfg): Promise<OrgSettings> {
    // Lazy-create: insert the defaults row if absent.
    // `onConflictDoNothing` on `org_settings_org_id_uq` means concurrent first-reads collapse
    // to one row — idempotent and safe under parallel resolver invocations.
    await this.tx
      .insert(orgSettings)
      .values({ orgId: this.orgId, booking: defaults() })
      .onConflictDoNothing({ target: orgSettings.orgId });

    // Fetch the settings row and the org name in parallel — one extra select, never per-row.
    // orgs.name is NOT in org_settings; it lives on the orgs table and is passed to the mapper
    // so brandName reflects the real org display name without duplicating the column.
    const [rows, orgRows] = await Promise.all([
      this.tx
        .select()
        .from(orgSettings)
        .where(eq(orgSettings.orgId, this.orgId))
        .limit(1),
      this.tx
        .select({ name: orgs.name })
        .from(orgs)
        .where(eq(orgs.id, this.orgId))
        .limit(1),
    ]);

    const row = rows[0];
    if (!row) throw new Error("org_settings row missing after lazy create — check RLS policy");
    const orgName = orgRows[0]?.name ?? "My Business";
    return toOrgSettings(row, orgName);
  }

  async saveConfig(settings: OrgSettings): Promise<void> {
    const p = settings.props;
    await this.tx
      .update(orgSettings)
      .set({
        trade: p.trade,
        markupBps: p.markupBps,
        visitScopeMinutes: p.visitScopeMinutes,
        visitRepairMinutes: p.visitRepairMinutes,
        visitInstallMinutes: p.visitInstallMinutes,
        techSeesPrice: p.techSeesPrice,
        techTexts: p.techTexts,
        frontDesk: p.frontDesk,
        scopeOn: p.scopeOn,
        hoursWdOpen: p.hoursWdOpen,
        hoursWdClose: p.hoursWdClose,
        hoursSatOpen: p.hoursSatOpen,
        hoursSatClose: p.hoursSatClose,
        hoursSunOpen: p.hoursSunOpen,
        hoursSunClose: p.hoursSunClose,
        areaCities: p.areaCities,
        areaRadiusMi: p.areaRadiusMi,
        // Service origin (front-desk vertical coverage). Address + its geocoded point;
        // lat/lng are null when unset or the geocode missed.
        serviceOriginAddress: p.serviceOriginAddress,
        originLat: p.originLat,
        originLng: p.originLng,
        booking: p.booking,
        // Brand identity (Phase 3). brandName lives on orgs.name — setName handles that.
        // This write covers only the org_settings brand columns.
        brandTagline: p.brandTagline,
        brandSite: p.brandSite,
        brandColor: p.brandColor,
        brandLogoUrl: p.brandLogoUrl,
        brandInitials: p.brandInitials,
        updatedAt: p.updatedAt,
      })
      // Guard: match by org_id (the unique identity of this row) + RLS double-checks.
      .where(eq(orgSettings.orgId, this.orgId));
  }

  async getTechSeesPrice(): Promise<boolean> {
    const rows = await this.tx
      .select({ techSeesPrice: orgSettings.techSeesPrice })
      .from(orgSettings)
      .where(eq(orgSettings.orgId, this.orgId))
      .limit(1);
    // No row yet (settings never opened) → the column's schema default: visible.
    return rows[0]?.techSeesPrice ?? true;
  }

  // ── OrgNameWriter ──────────────────────────────────────────────────────────

  /**
   * Updates orgs.name for the current org. Brand NAME lives on the orgs table (not
   * org_settings) so it stays the single authoritative source. Guarded by RLS
   * (`id = current_org_id()`) — the runtime role can only update its own row.
   * Called from UpdateBrandUseCase inside the same withTenant tx as saveConfig, so
   * both writes commit or roll back atomically.
   *
   * `now` is accepted for port-signature symmetry; orgs has no updatedAt column.
   */
  async setName(orgId: string, name: string, _now: Date): Promise<void> {
    await this.tx
      .update(orgs)
      .set({ name })
      .where(eq(orgs.id, orgId));
  }

  // ── pricebook_items ────────────────────────────────────────────────────────

  async listPricebook(): Promise<PricebookItem[]> {
    const rows = await this.tx
      .select()
      .from(pricebookItems)
      .where(and(eq(pricebookItems.orgId, this.orgId), isNull(pricebookItems.deletedAt)))
      .orderBy(asc(pricebookItems.position), asc(pricebookItems.createdAt))
      .limit(LIST_LIMIT);
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      unitPriceCents: r.unitPriceCents,
      costCents: r.costCents,
      position: r.position,
    }));
  }

  async createPricebook(input: {
    id: string;
    orgId: string;
    label: string;
    unitPriceCents: number;
    costCents: number;
    position: number;
  }): Promise<PricebookItem> {
    const rows = await this.tx
      .insert(pricebookItems)
      .values({
        id: input.id,
        orgId: this.orgId,
        label: input.label,
        unitPriceCents: input.unitPriceCents,
        costCents: input.costCents,
        position: input.position,
      })
      .returning();
    const r = rows[0];
    if (!r) throw new Error("pricebook_items insert returned no row");
    return { id: r.id, label: r.label, unitPriceCents: r.unitPriceCents, costCents: r.costCents, position: r.position };
  }

  async savePricebook(item: PricebookItem, updatedAt: Date): Promise<number> {
    const rows = await this.tx
      .update(pricebookItems)
      .set({
        label: item.label,
        unitPriceCents: item.unitPriceCents,
        costCents: item.costCents,
        position: item.position,
        updatedAt,
      })
      .where(
        and(
          eq(pricebookItems.id, item.id),
          eq(pricebookItems.orgId, this.orgId),
          isNull(pricebookItems.deletedAt),
        ),
      )
      .returning();
    return rows.length;
  }

  async archivePricebook(id: string, now: Date): Promise<number> {
    const rows = await this.tx
      .update(pricebookItems)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(pricebookItems.id, id),
          eq(pricebookItems.orgId, this.orgId),
          isNull(pricebookItems.deletedAt),
        ),
      )
      .returning();
    return rows.length;
  }

  // ── labor_rates ────────────────────────────────────────────────────────────

  async listLaborRates(): Promise<LaborRate[]> {
    const rows = await this.tx
      .select()
      .from(laborRates)
      .where(and(eq(laborRates.orgId, this.orgId), isNull(laborRates.deletedAt)))
      .orderBy(asc(laborRates.position), asc(laborRates.createdAt))
      .limit(LIST_LIMIT);
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      rateCentsPerHour: r.rateCentsPerHour,
      kind: toLaborRateKind(r.kind),
      position: r.position,
    }));
  }

  async createLaborRate(input: {
    id: string;
    orgId: string;
    label: string;
    rateCentsPerHour: number;
    kind: LaborRateKind;
    position: number;
  }): Promise<LaborRate> {
    const rows = await this.tx
      .insert(laborRates)
      .values({
        id: input.id,
        orgId: this.orgId,
        label: input.label,
        rateCentsPerHour: input.rateCentsPerHour,
        kind: input.kind,
        position: input.position,
      })
      .returning();
    const r = rows[0];
    if (!r) throw new Error("labor_rates insert returned no row");
    return {
      id: r.id,
      label: r.label,
      rateCentsPerHour: r.rateCentsPerHour,
      kind: toLaborRateKind(r.kind),
      position: r.position,
    };
  }

  async saveLaborRate(rate: LaborRate, updatedAt: Date): Promise<number> {
    const rows = await this.tx
      .update(laborRates)
      .set({
        label: rate.label,
        rateCentsPerHour: rate.rateCentsPerHour,
        kind: rate.kind,
        position: rate.position,
        updatedAt,
      })
      .where(
        and(
          eq(laborRates.id, rate.id),
          eq(laborRates.orgId, this.orgId),
          isNull(laborRates.deletedAt),
        ),
      )
      .returning();
    return rows.length;
  }

  async countActiveLaborRates(): Promise<number> {
    // DB-side count aggregate: no LIMIT needed, returns single row with count.
    const [result] = await this.tx
      .select({ n: count() })
      .from(laborRates)
      .where(and(eq(laborRates.orgId, this.orgId), isNull(laborRates.deletedAt)));
    return result?.n ?? 0;
  }

  async archiveLaborRate(id: string, now: Date): Promise<number> {
    const rows = await this.tx
      .update(laborRates)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(laborRates.id, id),
          eq(laborRates.orgId, this.orgId),
          isNull(laborRates.deletedAt),
        ),
      )
      .returning();
    return rows.length;
  }

  // ── job_terms ──────────────────────────────────────────────────────────────

  async listTerms(): Promise<JobTerm[]> {
    const rows = await this.tx
      .select()
      .from(jobTerms)
      .where(and(eq(jobTerms.orgId, this.orgId), isNull(jobTerms.deletedAt)))
      .orderBy(asc(jobTerms.position), asc(jobTerms.createdAt))
      .limit(LIST_LIMIT);
    return rows.map((r) => ({ id: r.id, title: r.title, body: r.body, position: r.position }));
  }

  async createTerm(input: {
    id: string;
    orgId: string;
    title: string;
    body: string;
    position: number;
  }): Promise<JobTerm> {
    const rows = await this.tx
      .insert(jobTerms)
      .values({
        id: input.id,
        orgId: this.orgId,
        title: input.title,
        body: input.body,
        position: input.position,
      })
      .returning();
    const r = rows[0];
    if (!r) throw new Error("job_terms insert returned no row");
    return { id: r.id, title: r.title, body: r.body, position: r.position };
  }

  async saveTerm(term: JobTerm, updatedAt: Date): Promise<number> {
    const rows = await this.tx
      .update(jobTerms)
      .set({ title: term.title, body: term.body, position: term.position, updatedAt })
      .where(
        and(
          eq(jobTerms.id, term.id),
          eq(jobTerms.orgId, this.orgId),
          isNull(jobTerms.deletedAt),
        ),
      )
      .returning();
    return rows.length;
  }

  async archiveTerm(id: string, now: Date): Promise<number> {
    const rows = await this.tx
      .update(jobTerms)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(jobTerms.id, id),
          eq(jobTerms.orgId, this.orgId),
          isNull(jobTerms.deletedAt),
        ),
      )
      .returning();
    return rows.length;
  }

  // ── lead_sources ───────────────────────────────────────────────────────────

  async listSources(): Promise<LeadSource[]> {
    const rows = await this.tx
      .select()
      .from(leadSources)
      .where(and(eq(leadSources.orgId, this.orgId), isNull(leadSources.deletedAt)))
      .orderBy(asc(leadSources.position), asc(leadSources.createdAt))
      .limit(LIST_LIMIT);
    return rows.map((r) => ({ id: r.id, label: r.label, position: r.position }));
  }

  async createSource(input: {
    id: string;
    orgId: string;
    label: string;
    position: number;
  }): Promise<LeadSource> {
    const rows = await this.tx
      .insert(leadSources)
      .values({
        id: input.id,
        orgId: this.orgId,
        label: input.label,
        position: input.position,
      })
      .returning();
    const r = rows[0];
    if (!r) throw new Error("lead_sources insert returned no row");
    return { id: r.id, label: r.label, position: r.position };
  }

  async saveSource(source: LeadSource, updatedAt: Date): Promise<number> {
    const rows = await this.tx
      .update(leadSources)
      .set({ label: source.label, position: source.position, updatedAt })
      .where(
        and(
          eq(leadSources.id, source.id),
          eq(leadSources.orgId, this.orgId),
          isNull(leadSources.deletedAt),
        ),
      )
      .returning();
    return rows.length;
  }

  async archiveSource(id: string, now: Date): Promise<number> {
    const rows = await this.tx
      .update(leadSources)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(leadSources.id, id),
          eq(leadSources.orgId, this.orgId),
          isNull(leadSources.deletedAt),
        ),
      )
      .returning();
    return rows.length;
  }
}
