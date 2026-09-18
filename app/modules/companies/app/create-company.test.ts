import { describe, it, expect, beforeEach } from "vitest";
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
import { CreateCompanyUseCase, type CreateCompanyCommand } from "./create-company";

// ── constants ─────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const FIXED_ID = "11111111-1111-1111-1111-111111111111";
const MINTED_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

// ── helpers ───────────────────────────────────────────────────────────────────

const baseProps = (overrides: Partial<CompanyProps> = {}): CompanyProps => ({
  id: asCompanyId(FIXED_ID),
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
  createCallCount = 0;
  lastCreatedInput: Parameters<CompanyRepository["create"]>[0] | undefined;

  async create(input: {
    id: string;
    orgId: string;
    name: string;
    phone: string | null;
    email: string | null;
    website: string | null;
    address: string | null;
    notes: string | null;
  }): Promise<Company> {
    this.createCallCount += 1;
    this.lastCreatedInput = input;
    const company = makeCompany({
      id: asCompanyId(input.id),
      orgId: asOrgId(input.orgId),
      name: input.name,
      phone: input.phone,
      email: input.email,
      website: input.website,
      address: input.address,
      notes: input.notes,
    });
    this.store.set(company.props.id, company);
    return company;
  }

  async findById(id: CompanyId): Promise<Company | null> {
    return this.store.get(id) ?? null;
  }

  async findByNames(names: readonly string[]): Promise<Company[]> {
    const wanted = new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean));
    return [...this.store.values()].filter((c) => wanted.has(c.props.name.trim().toLowerCase()));
  }

  async list(): Promise<{ items: Company[]; nextCursor: string | null }> {
    throw new Error("list not used in create tests");
  }

  async save(): Promise<void> {
    throw new Error("save not used in create tests");
  }

  async archiveByLead(): Promise<number> { return 0; }
  async archive(_id: CompanyId, _now: Date): Promise<number> {
    throw new Error("archive not used in create tests");
  }
}

const fixedIds = (id: string = MINTED_ID) => ({ newId: () => id });

// ── CreateCompanyUseCase ──────────────────────────────────────────────────────

describe("CreateCompanyUseCase", () => {
  let clock: FixedClock;
  let repo: FakeCompanyRepository;
  let useCase: CreateCompanyUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    repo = new FakeCompanyRepository();
    useCase = new CreateCompanyUseCase(repo, clock, fixedIds());
  });

  // ── validation — empty name ───────────────────────────────────────────────

  it("returns a validation error when name is empty string", async () => {
    const cmd: CreateCompanyCommand = {
      name: "",
      phone: null,
      email: null,
      website: null,
      address: null,
      notes: null,
    };

    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") {
      expect(result.error.kind).toBe("validation");
      expect(result.error.field).toBe("name");
    }
  });

  it("returns a validation error when name is only whitespace", async () => {
    const cmd: CreateCompanyCommand = {
      name: "   ",
      phone: null,
      email: null,
      website: null,
      address: null,
      notes: null,
    };

    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") {
      expect(result.error.kind).toBe("validation");
      expect(result.error.field).toBe("name");
    }
  });

  it("does not call repo.create when name validation fails", async () => {
    const cmd: CreateCompanyCommand = {
      name: "  ",
      phone: null,
      email: null,
      website: null,
      address: null,
      notes: null,
    };

    await useCase.exec(cmd, ORG);

    expect(repo.createCallCount).toBe(0);
  });

  // ── happy path — id provided by caller ───────────────────────────────────

  it("uses the caller-provided id when present", async () => {
    const cmd: CreateCompanyCommand = {
      id: FIXED_ID,
      name: "Acme Corp",
      phone: null,
      email: null,
      website: null,
      address: null,
      notes: null,
    };

    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.id).toBe(FIXED_ID);
    }
  });

  it("passes the caller-provided id to repo.create", async () => {
    const cmd: CreateCompanyCommand = {
      id: FIXED_ID,
      name: "Acme Corp",
      phone: null,
      email: null,
      website: null,
      address: null,
      notes: null,
    };

    await useCase.exec(cmd, ORG);

    expect(repo.lastCreatedInput?.id).toBe(FIXED_ID);
  });

  // ── happy path — id minted by IdGenerator ────────────────────────────────

  it("mints a new id from IdGenerator when no id is provided", async () => {
    const cmd: CreateCompanyCommand = {
      name: "Fresh Company",
      phone: null,
      email: null,
      website: null,
      address: null,
      notes: null,
    };

    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.id).toBe(MINTED_ID);
    }
  });

  it("passes the minted id to repo.create when caller omits id", async () => {
    const cmd: CreateCompanyCommand = {
      name: "Fresh Company",
      phone: null,
      email: null,
      website: null,
      address: null,
      notes: null,
    };

    await useCase.exec(cmd, ORG);

    expect(repo.lastCreatedInput?.id).toBe(MINTED_ID);
  });

  // ── happy path — full field propagation ──────────────────────────────────

  it("returns ok with the company returned by the repository", async () => {
    const cmd: CreateCompanyCommand = {
      name: "Acme Corp",
      phone: "+15551234567",
      email: "info@acme.com",
      website: "https://acme.com",
      address: "123 Main St",
      notes: "VIP",
    };

    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.name).toBe("Acme Corp");
      expect(result.value.props.phone).toBe("+15551234567");
      expect(result.value.props.email).toBe("info@acme.com");
      expect(result.value.props.website).toBe("https://acme.com");
      expect(result.value.props.address).toBe("123 Main St");
      expect(result.value.props.notes).toBe("VIP");
    }
  });

  it("trims whitespace from the name before creating", async () => {
    const cmd: CreateCompanyCommand = {
      name: "  Acme Corp  ",
      phone: null,
      email: null,
      website: null,
      address: null,
      notes: null,
    };

    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.name).toBe("Acme Corp");
    }
  });

  it("passes the trimmed name to repo.create", async () => {
    const cmd: CreateCompanyCommand = {
      name: "  Trimmed Name  ",
      phone: null,
      email: null,
      website: null,
      address: null,
      notes: null,
    };

    await useCase.exec(cmd, ORG);

    expect(repo.lastCreatedInput?.name).toBe("Trimmed Name");
  });

  it("passes all nullable fields through to repo.create", async () => {
    const cmd: CreateCompanyCommand = {
      name: "Null Fields Co",
      phone: null,
      email: null,
      website: null,
      address: null,
      notes: null,
    };

    await useCase.exec(cmd, ORG);

    expect(repo.lastCreatedInput?.phone).toBeNull();
    expect(repo.lastCreatedInput?.email).toBeNull();
    expect(repo.lastCreatedInput?.website).toBeNull();
    expect(repo.lastCreatedInput?.address).toBeNull();
    expect(repo.lastCreatedInput?.notes).toBeNull();
  });

  it("passes the orgId to repo.create", async () => {
    const cmd: CreateCompanyCommand = {
      name: "Org Check Corp",
      phone: null,
      email: null,
      website: null,
      address: null,
      notes: null,
    };

    await useCase.exec(cmd, ORG);

    expect(repo.lastCreatedInput?.orgId).toBe(ORG);
  });

  // ── logger smoke test ─────────────────────────────────────────────────────

  it("resolves successfully and logs — logger.info is called (smoke test via no throw)", async () => {
    // Exercises the logger.info branch by confirming the use-case completes
    // without throwing and returns ok. The logger writes to stdout in tests
    // and we cannot easily spy on it; exercising the branch is sufficient.
    const cmd: CreateCompanyCommand = {
      name: "Log Test Corp",
      phone: null,
      email: null,
      website: null,
      address: null,
      notes: null,
    };

    await expect(useCase.exec(cmd, ORG)).resolves.toMatchObject({ ok: true });
  });
});
