import { describe, it, expect, beforeEach } from "vitest";
import {
  asMaterialId,
  asOrgId,
  FixedClock,
  isOk,
  type MaterialId,
  type OrgId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { Material, type MaterialProps } from "../domain/material";
import type { MaterialRepository } from "../domain/material-repository";
import { CreateMaterialUseCase, type CreateMaterialCommand } from "./create-material";

// ── constants ─────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const FIXED_ID = "11111111-1111-1111-1111-111111111111";
const MINTED_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

// ── helpers ───────────────────────────────────────────────────────────────────

const baseProps = (overrides: Partial<MaterialProps> = {}): MaterialProps => ({
  id: asMaterialId(FIXED_ID),
  orgId: ORG,
  categoryId: null,
  code: null,
  name: "1/2in Copper Pipe",
  description: null,
  unitCostCents: 250,
  unitPriceCents: 0,
  pricingMode: "rule" as const,
  unitOfMeasure: "each",
  markupBps: null,
  taxable: false,
  vendor: null,
  active: true,
  position: 0,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

const makeMaterial = (overrides: Partial<MaterialProps> = {}): Material => {
  const r = Material.create(baseProps(overrides));
  if (!isOk(r)) throw new Error(`Material.create failed: ${JSON.stringify(r.error)}`);
  return r.value;
};

// ── FakeMaterialRepository ────────────────────────────────────────────────────

class FakeMaterialRepository implements MaterialRepository {
  private readonly store = new Map<MaterialId, Material>();
  createCallCount = 0;
  lastCreatedInput: Parameters<MaterialRepository["create"]>[0] | undefined;
  listCallCount = 0;

  seed(material: Material): void {
    this.store.set(material.props.id, material);
  }

  async create(input: Parameters<MaterialRepository["create"]>[0]): Promise<Material> {
    this.createCallCount += 1;
    this.lastCreatedInput = input;
    const material = makeMaterial({
      id: asMaterialId(input.id),
      orgId: asOrgId(input.orgId),
      categoryId: input.categoryId,
      code: input.code,
      name: input.name,
      description: input.description,
      unitCostCents: input.unitCostCents,
      unitOfMeasure: input.unitOfMeasure,
      markupBps: input.markupBps,
      taxable: input.taxable,
      vendor: input.vendor,
      active: input.active,
      position: input.position,
    });
    this.store.set(material.props.id, material);
    return material;
  }

  async findById(id: MaterialId): Promise<Material | null> {
    return this.store.get(id) ?? null;
  }

  async list(
    _page: CursorPage,
    filter: { search?: string; categoryId?: string | null },
  ): Promise<Paginated<Material>> {
    this.listCallCount += 1;
    const search = filter.search?.trim().toLowerCase();
    const items = [...this.store.values()].filter((m) =>
      search ? m.props.name.toLowerCase().includes(search) : true,
    );
    return { items, nextCursor: null };
  }

  async save(): Promise<void> {
    throw new Error("save not used in create tests");
  }

  async archiveByLead(): Promise<number> { return 0; }
  async archive(): Promise<number> {
    throw new Error("archive not used in create tests");
  }
}

const fixedIds = (id: string = MINTED_ID) => ({ newId: () => id });

// ── CreateMaterialUseCase ─────────────────────────────────────────────────────

const fakeBands = { list: async () => [], replaceAll: async () => {} };

describe("CreateMaterialUseCase", () => {
  let clock: FixedClock;
  let repo: FakeMaterialRepository;
  let useCase: CreateMaterialUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-12T12:00:00Z"));
    repo = new FakeMaterialRepository();
    useCase = new CreateMaterialUseCase(repo, fakeBands, clock, fixedIds());
  });

  // ── validation — empty name ───────────────────────────────────────────────

  it("returns a validation error when name is empty string", async () => {
    const cmd: CreateMaterialCommand = { name: "", unitCostCents: 100 };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") {
      expect(result.error.field).toBe("name");
    }
  });

  it("returns a validation error when name is only whitespace", async () => {
    const cmd: CreateMaterialCommand = { name: "   ", unitCostCents: 100 };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") {
      expect(result.error.field).toBe("name");
    }
  });

  it("does not call repo.create when name validation fails", async () => {
    const cmd: CreateMaterialCommand = { name: "  ", unitCostCents: 100 };
    await useCase.exec(cmd, ORG);

    expect(repo.createCallCount).toBe(0);
  });

  // ── dedupe — case-insensitive name conflict ──────────────────────────────

  it("returns a conflict error when a material with the same name (any case) already exists", async () => {
    repo.seed(makeMaterial({ name: "1/2in Copper Pipe" }));

    const cmd: CreateMaterialCommand = { name: "1/2IN COPPER PIPE", unitCostCents: 100 };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("conflict");
  });

  it("does not call repo.create when the name is a duplicate", async () => {
    repo.seed(makeMaterial({ name: "1/2in Copper Pipe" }));

    const cmd: CreateMaterialCommand = { name: "1/2in copper pipe", unitCostCents: 100 };
    await useCase.exec(cmd, ORG);

    expect(repo.createCallCount).toBe(0);
  });

  it("allows a distinct name to be created", async () => {
    repo.seed(makeMaterial({ name: "1/2in Copper Pipe" }));

    const cmd: CreateMaterialCommand = { name: "3/4in Copper Pipe", unitCostCents: 100 };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
  });

  // ── cents clamping ────────────────────────────────────────────────────────

  it("clamps a negative unitCostCents to 0", async () => {
    const cmd: CreateMaterialCommand = { name: "Fresh", unitCostCents: -500 };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.unitCostCents).toBe(0);
  });

  it("rounds fractional cents", async () => {
    const cmd: CreateMaterialCommand = { name: "Fresh", unitCostCents: 100.6 };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.unitCostCents).toBe(101);
  });

  // ── markupBps validation ──────────────────────────────────────────────────

  it("returns a validation error for a negative markupBps", async () => {
    const cmd: CreateMaterialCommand = { name: "Fresh", unitCostCents: 100, markupBps: -1 };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") {
      expect(result.error.field).toBe("markupBps");
    }
  });

  it("does not call repo.create when markupBps validation fails", async () => {
    const cmd: CreateMaterialCommand = { name: "Fresh", unitCostCents: 100, markupBps: -1 };
    await useCase.exec(cmd, ORG);

    expect(repo.createCallCount).toBe(0);
  });

  it("accepts a null markupBps", async () => {
    const cmd: CreateMaterialCommand = { name: "Fresh", unitCostCents: 100, markupBps: null };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.markupBps).toBeNull();
  });

  it("accepts a non-negative markupBps", async () => {
    const cmd: CreateMaterialCommand = { name: "Fresh", unitCostCents: 100, markupBps: 3500 };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.markupBps).toBe(3500);
  });

  // ── happy path — id provided by caller ───────────────────────────────────

  it("uses the caller-provided id when present", async () => {
    const cmd: CreateMaterialCommand = { id: FIXED_ID, name: "Fresh Material", unitCostCents: 100 };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.id).toBe(FIXED_ID);
  });

  it("mints a new id from IdGenerator when no id is provided", async () => {
    const cmd: CreateMaterialCommand = { name: "Fresh Material", unitCostCents: 100 };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.id).toBe(MINTED_ID);
  });

  // ── defaults for unspecified fields ──────────────────────────────────────

  it("defaults optional fields when the command omits them", async () => {
    const cmd: CreateMaterialCommand = { name: "Bare Material", unitCostCents: 100 };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.categoryId).toBeNull();
      expect(result.value.props.code).toBeNull();
      expect(result.value.props.description).toBeNull();
      expect(result.value.props.unitOfMeasure).toBe("each");
      expect(result.value.props.markupBps).toBeNull();
      // TRUE by default, matching the column — an unanswered item is one the shop charges tax on.
      expect(result.value.props.taxable).toBe(true);
      expect(result.value.props.vendor).toBeNull();
      expect(result.value.props.active).toBe(true);
      expect(result.value.props.position).toBe(0);
    }
  });

  it("passes provided optional fields through to repo.create", async () => {
    const cmd: CreateMaterialCommand = {
      name: "Full Material",
      categoryId: "33333333-3333-3333-3333-333333333333",
      code: "CU-1-2",
      description: "Type L copper, 1/2 inch",
      unitCostCents: 250,
      unitOfMeasure: "ft",
      markupBps: 4000,
      taxable: true,
      vendor: "Ferguson",
      active: false,
      position: 3,
    };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.categoryId).toBe("33333333-3333-3333-3333-333333333333");
      expect(result.value.props.code).toBe("CU-1-2");
      expect(result.value.props.description).toBe("Type L copper, 1/2 inch");
      expect(result.value.props.unitOfMeasure).toBe("ft");
      expect(result.value.props.markupBps).toBe(4000);
      expect(result.value.props.taxable).toBe(true);
      expect(result.value.props.vendor).toBe("Ferguson");
      expect(result.value.props.active).toBe(false);
      expect(result.value.props.position).toBe(3);
    }
  });

  it("trims whitespace from the name before creating", async () => {
    const cmd: CreateMaterialCommand = { name: "  Trimmed Material  ", unitCostCents: 100 };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.name).toBe("Trimmed Material");
  });

  it("passes the orgId to repo.create", async () => {
    const cmd: CreateMaterialCommand = { name: "Org Check", unitCostCents: 100 };
    await useCase.exec(cmd, ORG);

    expect(repo.lastCreatedInput?.orgId).toBe(ORG);
  });
});
