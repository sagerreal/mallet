import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, isOk, type OrgId } from "@mallet/shared/types";
import { OrgSettings, type BookingCfg } from "../domain/org-settings";
import type {
  SettingsRepository, PricebookItem, LaborRate, LaborRateKind, JobTerm, LeadSource,
} from "../domain/settings-repository";
import { GetSettingsUseCase } from "./get-settings";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");

// Shared fake repository used by all settings app tests (via export).
// Mirrors the FakeCompanyRepository pattern from modules/companies/app/create-company.test.ts.
export class FakeSettingsRepository implements SettingsRepository {
  config: OrgSettings | null = null;
  pricebook: PricebookItem[] = [];
  laborRates: LaborRate[] = [];
  terms: JobTerm[] = [];
  sources: LeadSource[] = [];

  // Spy fields: capture the last updatedAt passed to each save method so tests can
  // assert that the use-case forwards clock.now() into the repository.
  lastPricebookUpdatedAt: Date | null = null;
  lastLaborRateUpdatedAt: Date | null = null;
  lastTermUpdatedAt: Date | null = null;
  lastSourceUpdatedAt: Date | null = null;

  async getConfig(orgId: string, defaults: () => BookingCfg): Promise<OrgSettings> {
    if (this.config) return this.config;
    const r = OrgSettings.create({
      orgId: asOrgId(orgId), trade: "plumbing", markupBps: 3500, taxBps: 0,
      visitScopeMinutes: 30, visitRepairMinutes: 90, visitInstallMinutes: 240,
      techSeesPrice: true, techTexts: true, frontDesk: true, scopeOn: false,
      autoRemind: true,
      measurementEstimating: false,
      timezone: "America/Los_Angeles",
      hoursWdOpen: 8, hoursWdClose: 17,
 hoursMonOpen: 8,
 hoursMonClose: 17,
 hoursTueOpen: 8,
 hoursTueClose: 17,
 hoursWedOpen: 8,
 hoursWedClose: 17,
 hoursThuOpen: 8,
 hoursThuClose: 17,
 hoursFriOpen: 8,
 hoursFriClose: 17, hoursSatOpen: 0, hoursSatClose: 0,
      hoursSunOpen: 0, hoursSunClose: 0, areaCities: "", areaRadiusMi: 25,
      serviceOriginAddress: null, originLat: null, originLng: null,
      booking: defaults(),
      brandName: "Test Business",
      brandTagline: null, brandSite: null, brandColor: null,
      brandLogoUrl: null, brandInitials: null,
      bizAddress: null, bizPhone: null, bizEmail: null, licenseNumber: null,
      stripeConnectedAccountId: null, stripeChargesEnabled: false, stripePayoutsEnabled: false,
      stripeDetailsSubmitted: false, stripeOnboardedAt: null,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T00:00:00Z"),
    });
    if (!isOk(r)) throw new Error("seed config invalid");
    this.config = r.value;
    return this.config;
  }

  async saveConfig(s: OrgSettings): Promise<void> { this.config = s; }

  async getTechSeesPrice(): Promise<boolean> { return this.config?.props.techSeesPrice ?? true; }

  async getTimezone(): Promise<string> { return this.config?.props.timezone ?? "America/Los_Angeles"; }

  async getTaxBps(): Promise<number> { return this.config?.props.taxBps ?? 0; }

  async hasConfig(): Promise<boolean> { return this.config !== null; }

  async listPricebook(): Promise<PricebookItem[]> { return this.pricebook; }

  async createPricebook(i: {
    id: string;
    orgId: string;
    label: string;
    unitPriceCents: number;
    costCents: number;
    position: number;
  }): Promise<PricebookItem> {
    const row: PricebookItem = { id: i.id, label: i.label, unitPriceCents: i.unitPriceCents, costCents: i.costCents, position: i.position };
    this.pricebook = [...this.pricebook, row];
    return row;
  }

  async savePricebook(item: PricebookItem, updatedAt: Date): Promise<number> {
    const exists = this.pricebook.some((p) => p.id === item.id);
    if (!exists) return 0;
    this.lastPricebookUpdatedAt = updatedAt;
    this.pricebook = this.pricebook.map((p) => (p.id === item.id ? item : p));
    return 1;
  }

  async archivePricebook(id: string, _now: Date): Promise<number> {
    const before = this.pricebook.length;
    this.pricebook = this.pricebook.filter((p) => p.id !== id);
    return before - this.pricebook.length;
  }

  async listLaborRates(): Promise<LaborRate[]> { return this.laborRates; }

  async createLaborRate(i: {
    id: string;
    orgId: string;
    label: string;
    rateCentsPerHour: number;
    kind: LaborRateKind;
    position: number;
  }): Promise<LaborRate> {
    const row: LaborRate = {
      id: i.id,
      label: i.label,
      rateCentsPerHour: i.rateCentsPerHour,
      kind: i.kind,
      position: i.position,
    };
    this.laborRates = [...this.laborRates, row];
    return row;
  }

  async saveLaborRate(r: LaborRate, updatedAt: Date): Promise<number> {
    const exists = this.laborRates.some((x) => x.id === r.id);
    if (!exists) return 0;
    this.lastLaborRateUpdatedAt = updatedAt;
    this.laborRates = this.laborRates.map((x) => (x.id === r.id ? r : x));
    return 1;
  }

  async countActiveLaborRates(): Promise<number> { return this.laborRates.length; }

  async archiveLaborRate(id: string, _now: Date): Promise<number> {
    const before = this.laborRates.length;
    this.laborRates = this.laborRates.filter((x) => x.id !== id);
    return before - this.laborRates.length;
  }

  async listTerms(): Promise<JobTerm[]> { return this.terms; }

  async createTerm(i: {
    id: string;
    orgId: string;
    title: string;
    body: string;
    position: number;
  }): Promise<JobTerm> {
    const row: JobTerm = { id: i.id, title: i.title, body: i.body, position: i.position };
    this.terms = [...this.terms, row];
    return row;
  }

  async saveTerm(t: JobTerm, updatedAt: Date): Promise<number> {
    const exists = this.terms.some((x) => x.id === t.id);
    if (!exists) return 0;
    this.lastTermUpdatedAt = updatedAt;
    this.terms = this.terms.map((x) => (x.id === t.id ? t : x));
    return 1;
  }

  async archiveTerm(id: string, _now: Date): Promise<number> {
    const before = this.terms.length;
    this.terms = this.terms.filter((x) => x.id !== id);
    return before - this.terms.length;
  }

  async listSources(): Promise<LeadSource[]> { return this.sources; }

  async createSource(i: {
    id: string;
    orgId: string;
    label: string;
    position: number;
  }): Promise<LeadSource> {
    const row: LeadSource = { id: i.id, label: i.label, position: i.position };
    this.sources = [...this.sources, row];
    return row;
  }

  async saveSource(s: LeadSource, updatedAt: Date): Promise<number> {
    const exists = this.sources.some((x) => x.id === s.id);
    if (!exists) return 0;
    this.lastSourceUpdatedAt = updatedAt;
    this.sources = this.sources.map((x) => (x.id === s.id ? s : x));
    return 1;
  }

  async archiveSource(id: string, _now: Date): Promise<number> {
    const before = this.sources.length;
    this.sources = this.sources.filter((x) => x.id !== id);
    return before - this.sources.length;
  }
}

describe("GetSettingsUseCase", () => {
  let repo: FakeSettingsRepository;
  let useCase: GetSettingsUseCase;

  beforeEach(() => {
    repo = new FakeSettingsRepository();
    useCase = new GetSettingsUseCase(repo);
  });

  /**
   * A first read creates the row, and its booking list is EMPTY.
   *
   * This used to assert the opposite — that a fresh org arrived with services already in it — and
   * what it was really pinning was nine hard-coded plumbing services with invented prices, handed
   * to every org whatever its trade. The services now come from the shop's own trade playbook at
   * signup; a trade with no playbook, and "Other", get none. Empty also keeps the front desk
   * switched off, since frontDeskReadiness needs at least one bookable service.
   */
  it("lazily creates a defaults config on first read, with no services of our invention", async () => {
    const result = await useCase.exec(ORG);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.config.props.trade).toBe("plumbing");
      expect(result.value.config.props.booking.services).toEqual([]);
    }
  });

  it("returns all four collections in the payload", async () => {
    await repo.createPricebook({ id: "p1", orgId: ORG, label: "Camera", unitPriceCents: 28500, costCents: 0, position: 0 });
    await repo.createSource({ id: "s1", orgId: ORG, label: "Google", position: 0 });
    const result = await useCase.exec(ORG);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.pricebook).toHaveLength(1);
      expect(result.value.sources).toHaveLength(1);
      expect(result.value.laborRates).toEqual([]);
      expect(result.value.terms).toEqual([]);
    }
  });
});
