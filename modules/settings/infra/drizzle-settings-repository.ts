import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import {
  orgs,
  orgSettings,
  pricebookItems,
  laborRates,
  jobTerms,
  leadSources,
  presentationTemplates,
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
  PresentationPage,
  PresentationTemplate,
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

// Mirrors org_settings.timezone's schema default. Duplicated here (rather than imported from the
// Drizzle column) because a focused read that skips the lazy create has no row to read it from,
// and the two must not drift: a shop that never opened Settings must resolve to the same zone
// whichever path asks.
const DEFAULT_TIMEZONE = "America/Los_Angeles";

// Mirrors org_settings.tax_bps's schema default, for the same reason DEFAULT_TIMEZONE is here: a
// focused read that skips the lazy create has no row to read it from. 0 = the shop has not set a
// rate, and a quote raised before it does must charge nothing rather than guess.
const DEFAULT_TAX_BPS = 0;

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
        taxBps: p.taxBps,
        visitScopeMinutes: p.visitScopeMinutes,
        visitRepairMinutes: p.visitRepairMinutes,
        visitInstallMinutes: p.visitInstallMinutes,
        techSeesPrice: p.techSeesPrice,
        techEditsTimes: p.techEditsTimes,
        otWeeklyThresholdMinutes: p.otWeeklyThresholdMinutes,
        otDailyThresholdMinutes: p.otDailyThresholdMinutes,
        techTexts: p.techTexts,
        frontDesk: p.frontDesk,
        scopeOn: p.scopeOn,
        autoRemind: p.autoRemind,
        measurementEstimating: p.measurementEstimating,
        hoursWdOpen: p.hoursWdOpen,
        hoursWdClose: p.hoursWdClose,
        // EACH DAY ITS OWN VALUE. These five used to be written from hoursWdOpen/Close — the
        // weekday default — so every save silently overwrote Monday-to-Friday with one pair of
        // hours. Editing "Friday closes at noon" appeared to work, then snapped back on the next
        // read, and the front desk went on booking Friday afternoons. Saturday and Sunday were
        // always written from their own columns, which is why only the weekdays misbehaved.
        hoursMonOpen: p.hoursMonOpen,
        hoursMonClose: p.hoursMonClose,
        hoursTueOpen: p.hoursTueOpen,
        hoursTueClose: p.hoursTueClose,
        hoursWedOpen: p.hoursWedOpen,
        hoursWedClose: p.hoursWedClose,
        hoursThuOpen: p.hoursThuOpen,
        hoursThuClose: p.hoursThuClose,
        hoursFriOpen: p.hoursFriOpen,
        hoursFriClose: p.hoursFriClose,
        hoursSatOpen: p.hoursSatOpen,
        hoursSatClose: p.hoursSatClose,
        hoursSunOpen: p.hoursSunOpen,
        hoursSunClose: p.hoursSunClose,
        timezone: p.timezone,
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
        // Business identity printed on customer documents (address/phone/email/licence).
        // Written here rather than on a second update so a business edit and a brand edit
        // cannot land in different transactions and half-apply.
        bizAddress: p.bizAddress,
        bizPhone: p.bizPhone,
        bizEmail: p.bizEmail,
        licenseNumber: p.licenseNumber,
        // Document wording overrides — written with the same save as everything else so a
        // wording edit and a config edit cannot half-apply across transactions.
        docInvoiceFooter: p.docInvoiceFooter,
        docInvoicePayInstructions: p.docInvoicePayInstructions,
        docInvoiceReceiptNote: p.docInvoiceReceiptNote,
        docChangeOrderAgreement: p.docChangeOrderAgreement,
        // Stripe Connect (Express) onboarding state (PR1).
        stripeConnectedAccountId: p.stripeConnectedAccountId,
        stripeChargesEnabled: p.stripeChargesEnabled,
        stripePayoutsEnabled: p.stripePayoutsEnabled,
        stripeDetailsSubmitted: p.stripeDetailsSubmitted,
        stripeOnboardedAt: p.stripeOnboardedAt,
        updatedAt: p.updatedAt,
      })
      // Guard: match by org_id (the unique identity of this row) + RLS double-checks.
      .where(eq(orgSettings.orgId, this.orgId));
  }

  /**
   * Just the shop's display name.
   *
   * Exists so callers that need only the name (the on-glass authorisation sentence) do not have to
   * load the whole settings aggregate and invent a BookingCfg default to do it.
   */
  async getOrgName(): Promise<string> {
    const rows = await this.tx.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, this.orgId)).limit(1);
    return rows[0]?.name ?? "My Business";
  }

  async getTechEditsTimes(): Promise<boolean> {
    const rows = await this.tx
      .select({ techEditsTimes: orgSettings.techEditsTimes })
      .from(orgSettings)
      .where(eq(orgSettings.orgId, this.orgId))
      .limit(1);
    // No row yet (settings never opened) → the column's schema default: OFF. The clock and the
    // visit taps are the field's only writers until the shop opts in.
    return rows[0]?.techEditsTimes ?? false;
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

  async getTaxBps(): Promise<number> {
    const rows = await this.tx
      .select({ taxBps: orgSettings.taxBps })
      .from(orgSettings)
      .where(eq(orgSettings.orgId, this.orgId))
      .limit(1);
    // No row yet (settings never opened) → the column's schema default, 0. Same no-lazy-create
    // rule as getTechSeesPrice/getTimezone: a read on the signing path must not write.
    return rows[0]?.taxBps ?? DEFAULT_TAX_BPS;
  }

  async getTimezone(): Promise<string> {
    const rows = await this.tx
      .select({ timezone: orgSettings.timezone })
      .from(orgSettings)
      .where(eq(orgSettings.orgId, this.orgId))
      .limit(1);
    // No row yet (settings never opened) → the column's schema default. Falling back rather than
    // lazy-creating keeps this read side-effect-free, and a shop that never opened Settings still
    // gets a real zone instead of UTC, which would file a West-coast evening on tomorrow's sheet.
    return rows[0]?.timezone ?? DEFAULT_TIMEZONE;
  }

  /**
   * Existence check with no lazy create — mirrors getTechSeesPrice/getTimezone. Callers that
   * need to tell "brand-new org" from "org already has settings" (signup's one-time timezone
   * derivation) must call this BEFORE getConfig, whose lazy insert would otherwise make every
   * org look pre-existing by the time anyone checks.
   */
  async hasConfig(): Promise<boolean> {
    const rows = await this.tx
      .select({ id: orgSettings.id })
      .from(orgSettings)
      .where(eq(orgSettings.orgId, this.orgId))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Focused, side-effect-free read of the org's Connect charge target (PR1 onboarding state) —
   * used by the invoicing charge path to route a destination charge and gate on charges-enabled.
   * No lazy create (mirrors getTechSeesPrice): a shop that never onboarded reads as not-enabled.
   */
  async getConnectTarget(): Promise<{ connectedAccountId: string | null; chargesEnabled: boolean }> {
    const rows = await this.tx
      .select({
        connectedAccountId: orgSettings.stripeConnectedAccountId,
        chargesEnabled: orgSettings.stripeChargesEnabled,
      })
      .from(orgSettings)
      .where(eq(orgSettings.orgId, this.orgId))
      .limit(1);
    const row = rows[0];
    return {
      connectedAccountId: row?.connectedAccountId ?? null,
      chargesEnabled: row?.chargesEnabled ?? false,
    };
  }

  /**
   * Focused, side-effect-free read of the shop's visit/diagnostic fee, IN CENTS.
   *
   * `booking.serviceFee` is stored in DOLLARS inside the booking jsonb blob (documented on
   * BookingCfg), and every caller outside settings works in cents — so the conversion happens here,
   * once, rather than at each call site where a missed ×100 would undercharge a customer 100-fold.
   *
   * No lazy create (mirrors getTechSeesPrice / getConnectTarget): a shop that never opened Settings
   * reads as no fee configured, which the caller must treat as "don't offer it" rather than "$0".
   * Class-only, not on the SettingsRepository port — same as getConnectTarget: a focused read for
   * another module's adapter, not part of the settings use-cases' contract.
   */
  async getServiceFeeCents(): Promise<number> {
    const rows = await this.tx
      .select({ fee: sql<string | null>`${orgSettings.booking} ->> 'serviceFee'` })
      .from(orgSettings)
      .where(eq(orgSettings.orgId, this.orgId))
      .limit(1);
    const raw = rows[0]?.fee;
    const dollars = raw === null || raw === undefined ? 0 : Number(raw);
    // A malformed blob must not become NaN cents on a customer's bill.
    if (!Number.isFinite(dollars) || dollars <= 0) return 0;
    return Math.round(dollars * 100);
  }

  /**
   * Focused, side-effect-free read of the org's Terminal Location id (Tap to Pay). No lazy create
   * (mirrors getConnectTarget): a shop that never ran Terminal setup reads as null. Class-only,
   * not on the SettingsRepository port — a focused seam for invoicing's adapter, same as
   * getConnectTarget / getServiceFeeCents.
   */
  async getTerminalLocationId(): Promise<string | null> {
    const rows = await this.tx
      .select({ locationId: orgSettings.stripeTerminalLocationId })
      .from(orgSettings)
      .where(eq(orgSettings.orgId, this.orgId))
      .limit(1);
    return rows[0]?.locationId ?? null;
  }

  /**
   * Persist the org's one Terminal Location id. A focused single-column UPDATE (setName
   * precedent) rather than a domain patch: no settings use-case ever touches this value, and
   * keeping it OFF OrgSettingsProps means a concurrent full-config saveConfig can never clobber a
   * location id ensured mid-flight. The row is guaranteed to exist by the caller's own gate — a
   * location is only ever created for a charges-enabled shop, and charges_enabled lives on this
   * same row — so zero rows updated is a real invariant break, not a lazily-absent row.
   */
  async setTerminalLocationId(locationId: string, now: Date): Promise<void> {
    const rows = await this.tx
      .update(orgSettings)
      .set({ stripeTerminalLocationId: locationId, updatedAt: now })
      .where(eq(orgSettings.orgId, this.orgId))
      .returning({ id: orgSettings.id });
    if (rows.length === 0) {
      throw new Error("org_settings row missing while saving a Terminal location — Connect state is inconsistent");
    }
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

  async listPresentationTemplates(): Promise<PresentationTemplate[]> {
    const rows = await this.tx
      .select()
      .from(presentationTemplates)
      .where(and(eq(presentationTemplates.orgId, this.orgId), isNull(presentationTemplates.deletedAt)))
      .orderBy(asc(presentationTemplates.position), asc(presentationTemplates.createdAt))
      .limit(LIST_LIMIT);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      // Jsonb read-back cast — the shape is ours on the way in (zod-validated at the boundary).
      pages: r.pages as PresentationPage[],
      position: r.position,
    }));
  }

  async createPresentationTemplate(input: {
    id: string;
    orgId: string;
    name: string;
    pages: readonly PresentationPage[];
    position: number;
  }): Promise<PresentationTemplate> {
    const rows = await this.tx
      .insert(presentationTemplates)
      .values({
        id: input.id,
        orgId: this.orgId,
        name: input.name,
        pages: [...input.pages],
        position: input.position,
      })
      .returning();
    const r = rows[0];
    if (!r) throw new Error("presentation_templates insert returned no row");
    return { id: r.id, name: r.name, pages: r.pages as PresentationPage[], position: r.position };
  }

  async savePresentationTemplate(template: PresentationTemplate, updatedAt: Date): Promise<number> {
    const rows = await this.tx
      .update(presentationTemplates)
      .set({ name: template.name, pages: [...template.pages], position: template.position, updatedAt })
      .where(
        and(
          eq(presentationTemplates.id, template.id),
          eq(presentationTemplates.orgId, this.orgId),
          isNull(presentationTemplates.deletedAt),
        ),
      )
      .returning();
    return rows.length;
  }

  async archivePresentationTemplate(id: string, now: Date): Promise<number> {
    const rows = await this.tx
      .update(presentationTemplates)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(presentationTemplates.id, id),
          eq(presentationTemplates.orgId, this.orgId),
          isNull(presentationTemplates.deletedAt),
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
