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
import { ArchiveCompanyUseCase, type ArchiveCompanyCommand } from "./archive-company";

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
  archiveCallCount = 0;
  archiveLastArgs: { id: CompanyId; now: Date } | null = null;

  seed(company: Company): void {
    this.store.set(company.props.id, company);
  }

  async archiveByLead(): Promise<number> { return 0; }
  async archive(id: CompanyId, now: Date): Promise<number> {
    this.archiveCallCount += 1;
    this.archiveLastArgs = { id, now };
    const exists = this.store.has(id);
    if (exists) {
      this.store.delete(id);
      return 1;
    }
    return 0;
  }

  async findById(id: CompanyId): Promise<Company | null> {
    return this.store.get(id) ?? null;
  }

  async save(_company: Company): Promise<void> {
    throw new Error("save not used in archive tests");
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
    throw new Error("create not used in archive tests");
  }

  async findByNames(names: readonly string[]): Promise<Company[]> {
    const wanted = new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean));
    return [...this.store.values()].filter((c) => wanted.has(c.props.name.trim().toLowerCase()));
  }

  async list(): Promise<{ items: Company[]; nextCursor: string | null }> {
    throw new Error("list not used in archive tests");
  }
}

// ── ArchiveCompanyUseCase ─────────────────────────────────────────────────────

describe("ArchiveCompanyUseCase", () => {
  let clock: FixedClock;
  let repo: FakeCompanyRepository;
  let useCase: ArchiveCompanyUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    repo = new FakeCompanyRepository();
    useCase = new ArchiveCompanyUseCase(repo, clock);
  });

  // ── not_found (count === 0) ───────────────────────────────────────────────

  it("returns not_found error when the company does not exist", async () => {
    const cmd: ArchiveCompanyCommand = { companyId: MISSING_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
    }
  });

  it("returns not_found error when the company was already archived (count === 0)", async () => {
    // company was never seeded, so repo.archive returns 0
    const cmd: ArchiveCompanyCommand = { companyId: COMPANY_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
    }
  });

  it("passes clock.now() to archive so the deletedAt timestamp is correct", async () => {
    // even on a miss we can inspect the args that were forwarded
    const cmd: ArchiveCompanyCommand = { companyId: MISSING_ID };
    await useCase.exec(cmd, ORG);

    expect(repo.archiveLastArgs?.now.toISOString()).toBe(clock.now().toISOString());
  });

  // ── happy path ────────────────────────────────────────────────────────────

  it("returns { ok: true } when the company is successfully archived", async () => {
    repo.seed(makeCompany());

    const cmd: ArchiveCompanyCommand = { companyId: COMPANY_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(true);
    if (isOk(result)) {
      expect(result.value.ok).toBe(true);
    }
  });

  it("calls archive exactly once on the happy path", async () => {
    repo.seed(makeCompany());

    const cmd: ArchiveCompanyCommand = { companyId: COMPANY_ID };
    await useCase.exec(cmd, ORG);

    expect(repo.archiveCallCount).toBe(1);
  });

  it("forwards the correct companyId to archive", async () => {
    repo.seed(makeCompany());

    const cmd: ArchiveCompanyCommand = { companyId: COMPANY_ID };
    await useCase.exec(cmd, ORG);

    expect(repo.archiveLastArgs?.id).toBe(COMPANY_ID);
  });

  it("forwards clock.now() to archive on the happy path", async () => {
    repo.seed(makeCompany());

    const cmd: ArchiveCompanyCommand = { companyId: COMPANY_ID };
    await useCase.exec(cmd, ORG);

    expect(repo.archiveLastArgs?.now.toISOString()).toBe(clock.now().toISOString());
  });
});
