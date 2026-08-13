import { describe, it, expect, beforeEach } from "vitest";
import {
  asCompanyId,
  asOrgId,
  isOk,
  type CompanyId,
  type OrgId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { Company, type CompanyProps } from "../domain/company";
import type { CompanyRepository } from "../domain/company-repository";
import { ListCompaniesUseCase, type ListCompaniesQuery } from "./list-companies";

// ── constants ─────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const COMPANY_ID_A: CompanyId = asCompanyId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const COMPANY_ID_B: CompanyId = asCompanyId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

// ── helpers ───────────────────────────────────────────────────────────────────

const baseProps = (overrides: Partial<CompanyProps> = {}): CompanyProps => ({
  id: COMPANY_ID_A,
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
  private readonly store: Company[] = [];
  listCallCount = 0;
  lastListPage: CursorPage | null = null;

  // Allows tests to control the exact Paginated result the repo returns.
  private _nextResult: Paginated<Company> | null = null;

  seed(company: Company): void {
    this.store.push(company);
  }

  setNextResult(result: Paginated<Company>): void {
    this._nextResult = result;
  }

  async findByNames(names: readonly string[]): Promise<Company[]> {
    const wanted = new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean));
    return [...this.store.values()].filter((c) => wanted.has(c.props.name.trim().toLowerCase()));
  }

  async list(page: CursorPage): Promise<Paginated<Company>> {
    this.listCallCount += 1;
    this.lastListPage = page;
    if (this._nextResult !== null) {
      return this._nextResult;
    }
    // Default: return all seeded items with no next page.
    return { items: [...this.store], nextCursor: null };
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
    throw new Error("create not used in list tests");
  }

  async findById(_id: CompanyId): Promise<Company | null> {
    throw new Error("findById not used in list tests");
  }

  async save(_company: Company): Promise<void> {
    throw new Error("save not used in list tests");
  }

  async archiveByLead(): Promise<number> { return 0; }
  async archive(_id: CompanyId, _now: Date): Promise<number> {
    throw new Error("archive not used in list tests");
  }
}

// ── ListCompaniesUseCase ──────────────────────────────────────────────────────

describe("ListCompaniesUseCase", () => {
  let repo: FakeCompanyRepository;
  let useCase: ListCompaniesUseCase;

  beforeEach(() => {
    repo = new FakeCompanyRepository();
    useCase = new ListCompaniesUseCase(repo);
  });

  // ── delegation ────────────────────────────────────────────────────────────

  it("calls repo.list exactly once per exec invocation", async () => {
    const query: ListCompaniesQuery = { page: { limit: 25, cursor: null } };
    await useCase.exec(query);
    expect(repo.listCallCount).toBe(1);
  });

  it("forwards the page parameter from the query to repo.list", async () => {
    const page: CursorPage = { limit: 10, cursor: "some-cursor" };
    const query: ListCompaniesQuery = { page };
    await useCase.exec(query);
    expect(repo.lastListPage).toEqual(page);
  });

  it("forwards the limit exactly as given in the query", async () => {
    const query: ListCompaniesQuery = { page: { limit: 50, cursor: null } };
    await useCase.exec(query);
    expect(repo.lastListPage?.limit).toBe(50);
  });

  it("forwards a non-null cursor to repo.list", async () => {
    const cursor = "dGVzdC1jdXJzb3I"; // arbitrary base64 string
    const query: ListCompaniesQuery = { page: { limit: 25, cursor } };
    await useCase.exec(query);
    expect(repo.lastListPage?.cursor).toBe(cursor);
  });

  it("forwards a null cursor to repo.list", async () => {
    const query: ListCompaniesQuery = { page: { limit: 25, cursor: null } };
    await useCase.exec(query);
    expect(repo.lastListPage?.cursor).toBeNull();
  });

  // ── result pass-through ───────────────────────────────────────────────────

  it("returns the exact Paginated result the repository resolves with", async () => {
    const companyA = makeCompany({ id: COMPANY_ID_A, name: "Acme Corp" });
    const companyB = makeCompany({ id: COMPANY_ID_B, name: "Beta LLC" });
    const expected: Paginated<Company> = { items: [companyA, companyB], nextCursor: null };
    repo.setNextResult(expected);

    const result = await useCase.exec({ page: { limit: 25, cursor: null } });

    expect(result).toBe(expected); // reference equality — no wrapping
  });

  it("returns an empty items array when the repository returns no companies", async () => {
    repo.setNextResult({ items: [], nextCursor: null });

    const result = await useCase.exec({ page: { limit: 25, cursor: null } });

    expect(result.items).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it("returns a non-null nextCursor when the repository signals more pages", async () => {
    const company = makeCompany();
    const nextCursor = "bmV4dC1wYWdl";
    repo.setNextResult({ items: [company], nextCursor });

    const result = await useCase.exec({ page: { limit: 1, cursor: null } });

    expect(result.nextCursor).toBe(nextCursor);
  });

  it("returns all items the repository provides without modification", async () => {
    const companyA = makeCompany({ id: COMPANY_ID_A, name: "Acme Corp" });
    const companyB = makeCompany({ id: COMPANY_ID_B, name: "Beta LLC" });
    repo.seed(companyA);
    repo.seed(companyB);

    const result = await useCase.exec({ page: { limit: 25, cursor: null } });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toBe(companyA);
    expect(result.items[1]).toBe(companyB);
  });

  it("propagates a rejection thrown by repo.list", async () => {
    const error = new Error("database connection lost");
    repo.list = async (_page: CursorPage) => {
      throw error;
    };

    await expect(useCase.exec({ page: { limit: 25, cursor: null } })).rejects.toThrow(
      "database connection lost",
    );
  });
});
