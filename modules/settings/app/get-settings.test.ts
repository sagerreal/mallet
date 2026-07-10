import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, isOk, type OrgId } from "@mallet/shared/types";
import { OrgSettings, type BookingCfg } from "../domain/org-settings";
import type {
  SettingsRepository, PricebookItem, LaborRate, JobTerm, LeadSource,
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

  async getConfig(orgId: string, defaults: () => BookingCfg): Promise<OrgSettings> {
    if (this.config) return this.config;
    const r = OrgSettings.create({
      orgId: asOrgId(orgId), trade: "plumbing", markupBps: 3500,
      visitScopeMinutes: 30, visitRepairMinutes: 90, visitInstallMinutes: 240,
      techSeesPrice: true, techTexts: true, frontDesk: true, scopeOn: false,
      hoursWdOpen: 8, hoursWdClose: 17, hoursSatOpen: 0, hoursSatClose: 0,
      hoursSunOpen: 0, hoursSunClose: 0, areaCities: "", areaRadiusMi: 25,
      booking: defaults(), createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T00:00:00Z"),
    });
    if (!isOk(r)) throw new Error("seed config invalid");
    this.config = r.value;
    return this.config;
  }

  async saveConfig(s: OrgSettings): Promise<void> { this.config = s; }

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

  async savePricebook(item: PricebookItem): Promise<number> {
    const prev = this.pricebook;
    this.pricebook = prev.map((p) => (p.id === item.id ? item : p));
    return this.pricebook.some((p) => p.id === item.id) ? 1 : 0;
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
    position: number;
  }): Promise<LaborRate> {
    const row: LaborRate = { id: i.id, label: i.label, rateCentsPerHour: i.rateCentsPerHour, position: i.position };
    this.laborRates = [...this.laborRates, row];
    return row;
  }

  async saveLaborRate(r: LaborRate): Promise<number> {
    this.laborRates = this.laborRates.map((x) => (x.id === r.id ? r : x));
    return this.laborRates.some((x) => x.id === r.id) ? 1 : 0;
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

  async saveTerm(t: JobTerm): Promise<number> {
    this.terms = this.terms.map((x) => (x.id === t.id ? t : x));
    return this.terms.some((x) => x.id === t.id) ? 1 : 0;
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

  async saveSource(s: LeadSource): Promise<number> {
    this.sources = this.sources.map((x) => (x.id === s.id ? s : x));
    return this.sources.some((x) => x.id === s.id) ? 1 : 0;
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

  it("lazily creates a defaults config on first read", async () => {
    const result = await useCase.exec(ORG);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.config.props.trade).toBe("plumbing");
      expect(result.value.config.props.booking.services.length).toBeGreaterThan(0);
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
