import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  asCompanyId,
  asOrgId,
  FixedClock,
  isOk,
  type CompanyId,
  type OrgId,
} from "@mallet/shared/types";
import { Company, type CompanyProps } from "../domain/company";
import type { CompanyRepository } from "../domain/company-repository";
import { UpdateCompanyUseCase, type UpdateCompanyCommand } from "./update-company";

// ── constants ─────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const COMPANY_ID: CompanyId = asCompanyId("11111111-1111-1111-1111-111111111111");
const MISSING_ID: CompanyId = asCompanyId("99999999-9999-9999-9999-999999999999");

// ── helpers ───────────────────────────────────────────────────────────────────

const baseProps = (overrides: Partial<CompanyProps> = {}): CompanyProps => ({
  id: COMPANY_ID,
  orgId: ORG,
  name: "Acme Corp",
  phone: null,
  email: null,
  website: null,
  address: null,
  notes: null,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

const makeCompany = (overrides: Partial<CompanyProps> = {}): Company => {
  const r = Company.create(baseProps(overrides));
  if (!isOk(r)) throw new Error(`Company.create failed: ${JSON.stringify(r.error)}`);
  return r.value;
};

// ── FakeCompanyRepository ─────────────────────────────────────────────────────

class FakeCompanyRepository implements CompanyRepository {
  private readonly store = new Map<CompanyId, Company>();
  saveCallCount = 0;

  seed(company: Company): void {
    this.store.set(company.props.id, company);
  }

  async findById(id: CompanyId): Promise<Company | null> {
    return this.store.get(id) ?? null;
  }

  async save(company: Company): Promise<void> {
    this.saveCallCount += 1;
    this.store.set(company.props.id, company);
  }

  async create(_input: {
    id: string;
    orgId: string;
    name: string;
    phone: string | null;
    email: string | null;
    website: string | null;
    address: string | null;
    notes: string | null;
  }): Promise<Company> {
    throw new Error("create not used in update tests");
  }

  async list(): Promise<{ items: Company[]; nextCursor: string | null }> {
    throw new Error("list not used in update tests");
  }

  async archiveByLead(): Promise<number> { return 0; }
  async archive(_id: CompanyId, _now: Date): Promise<number> {
    throw new Error("archive not used in update tests");
  }
}

// ── UpdateCompanyUseCase ──────────────────────────────────────────────────────

describe("UpdateCompanyUseCase", () => {
  let clock: FixedClock;
  let repo: FakeCompanyRepository;
  let useCase: UpdateCompanyUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    repo = new FakeCompanyRepository();
    useCase = new UpdateCompanyUseCase(repo, clock);
  });

  // ── not_found ─────────────────────────────────────────────────────────────

  it("returns not_found when the company does not exist", async () => {
    const cmd: UpdateCompanyCommand = { companyId: MISSING_ID, name: "New Name" };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
    }
  });

  it("does not call save when company is not found", async () => {
    const cmd: UpdateCompanyCommand = { companyId: MISSING_ID, name: "New Name" };
    await useCase.exec(cmd, ORG);

    expect(repo.saveCallCount).toBe(0);
  });

  // ── domain validation failure (patch returns err) ─────────────────────────

  it("returns validation error when patch produces an empty name", async () => {
    repo.seed(makeCompany());

    const cmd: UpdateCompanyCommand = { companyId: COMPANY_ID, name: "   " };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") {
      expect(result.error.kind).toBe("validation");
      expect(result.error.field).toBe("name");
    }
  });

  it("does not call save when patch validation fails", async () => {
    repo.seed(makeCompany());

    const cmd: UpdateCompanyCommand = { companyId: COMPANY_ID, name: "   " };
    await useCase.exec(cmd, ORG);

    expect(repo.saveCallCount).toBe(0);
  });

  // ── happy path ────────────────────────────────────────────────────────────

  it("returns the updated company on success", async () => {
    repo.seed(makeCompany());

    const cmd: UpdateCompanyCommand = {
      companyId: COMPANY_ID,
      name: "Acme Corp Ltd",
      phone: "+15551234567",
      email: "hello@acme.com",
      website: "https://acme.com",
      address: "123 Main St",
      notes: "Preferred vendor",
    };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.name).toBe("Acme Corp Ltd");
      expect(result.value.props.phone).toBe("+15551234567");
      expect(result.value.props.email).toBe("hello@acme.com");
      expect(result.value.props.website).toBe("https://acme.com");
      expect(result.value.props.address).toBe("123 Main St");
      expect(result.value.props.notes).toBe("Preferred vendor");
    }
  });

  it("stamps updatedAt with clock.now() on a successful update", async () => {
    repo.seed(makeCompany());

    const cmd: UpdateCompanyCommand = { companyId: COMPANY_ID, name: "Updated Name" };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.updatedAt.toISOString()).toBe(clock.now().toISOString());
    }
  });

  it("persists the patched company so a subsequent findById reflects the changes", async () => {
    repo.seed(makeCompany());

    const cmd: UpdateCompanyCommand = { companyId: COMPANY_ID, name: "Persisted Name" };
    await useCase.exec(cmd, ORG);

    const saved = await repo.findById(COMPANY_ID);
    expect(saved?.props.name).toBe("Persisted Name");
  });

  it("calls save exactly once on a successful update", async () => {
    repo.seed(makeCompany());

    const cmd: UpdateCompanyCommand = { companyId: COMPANY_ID, name: "Once" };
    await useCase.exec(cmd, ORG);

    expect(repo.saveCallCount).toBe(1);
  });

  it("allows clearing optional fields to null", async () => {
    repo.seed(makeCompany({ phone: "+15551234567", notes: "Some notes" }));

    const cmd: UpdateCompanyCommand = {
      companyId: COMPANY_ID,
      phone: null,
      notes: null,
    };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.phone).toBeNull();
      expect(result.value.props.notes).toBeNull();
    }
  });

  it("preserves fields that are not included in the command (undefined = keep current)", async () => {
    repo.seed(makeCompany({ phone: "+15551234567", email: "keep@acme.com" }));

    // Only update the name; phone and email must remain unchanged
    const cmd: UpdateCompanyCommand = { companyId: COMPANY_ID, name: "Changed" };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.phone).toBe("+15551234567");
      expect(result.value.props.email).toBe("keep@acme.com");
      expect(result.value.props.name).toBe("Changed");
    }
  });
});
