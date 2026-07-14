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
import { UpdateMaterialUseCase, type UpdateMaterialCommand } from "./update-material";

// ── constants ─────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const MATERIAL_ID: MaterialId = asMaterialId("11111111-1111-1111-1111-111111111111");
const MISSING_ID: MaterialId = asMaterialId("99999999-9999-9999-9999-999999999999");

// ── helpers ───────────────────────────────────────────────────────────────────

const baseProps = (overrides: Partial<MaterialProps> = {}): MaterialProps => ({
  id: MATERIAL_ID,
  orgId: ORG,
  categoryId: null,
  code: null,
  name: "1/2in Copper Pipe",
  description: null,
  unitCostCents: 250,
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
  saveCallCount = 0;

  seed(material: Material): void {
    this.store.set(material.props.id, material);
  }

  async findById(id: MaterialId): Promise<Material | null> {
    return this.store.get(id) ?? null;
  }

  async save(material: Material): Promise<void> {
    this.saveCallCount += 1;
    this.store.set(material.props.id, material);
  }

  async create(): Promise<Material> {
    throw new Error("create not used in update tests");
  }

  async list(
    _page: CursorPage,
    _filter: { search?: string; categoryId?: string | null },
  ): Promise<Paginated<Material>> {
    throw new Error("list not used in update tests");
  }

  async archiveByLead(): Promise<number> { return 0; }
  async archive(): Promise<number> {
    throw new Error("archive not used in update tests");
  }
}

// ── UpdateMaterialUseCase ─────────────────────────────────────────────────────

describe("UpdateMaterialUseCase", () => {
  let clock: FixedClock;
  let repo: FakeMaterialRepository;
  let useCase: UpdateMaterialUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-12T12:00:00Z"));
    repo = new FakeMaterialRepository();
    useCase = new UpdateMaterialUseCase(repo, clock);
  });

  // ── not_found ─────────────────────────────────────────────────────────────

  it("returns not_found when the material does not exist", async () => {
    const cmd: UpdateMaterialCommand = { materialId: MISSING_ID, name: "New Name" };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not_found");
  });

  it("does not call save when material is not found", async () => {
    const cmd: UpdateMaterialCommand = { materialId: MISSING_ID, name: "New Name" };
    await useCase.exec(cmd, ORG);

    expect(repo.saveCallCount).toBe(0);
  });

  // ── domain validation failure (patch returns err) ─────────────────────────

  it("returns validation error when patch produces an empty name", async () => {
    repo.seed(makeMaterial());

    const cmd: UpdateMaterialCommand = { materialId: MATERIAL_ID, name: "   " };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") {
      expect(result.error.field).toBe("name");
    }
  });

  it("returns validation error when patch produces a negative unitCostCents", async () => {
    repo.seed(makeMaterial());

    const cmd: UpdateMaterialCommand = { materialId: MATERIAL_ID, unitCostCents: -1 };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("validation");
  });

  it("returns validation error when patch produces a negative markupBps", async () => {
    repo.seed(makeMaterial());

    const cmd: UpdateMaterialCommand = { materialId: MATERIAL_ID, markupBps: -1 };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("validation");
  });

  it("does not call save when patch validation fails", async () => {
    repo.seed(makeMaterial());

    const cmd: UpdateMaterialCommand = { materialId: MATERIAL_ID, name: "   " };
    await useCase.exec(cmd, ORG);

    expect(repo.saveCallCount).toBe(0);
  });

  // ── happy path ────────────────────────────────────────────────────────────

  it("returns the updated material on success", async () => {
    repo.seed(makeMaterial());

    const cmd: UpdateMaterialCommand = {
      materialId: MATERIAL_ID,
      name: "3/4in Copper Pipe",
      unitCostCents: 350,
    };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.name).toBe("3/4in Copper Pipe");
      expect(result.value.props.unitCostCents).toBe(350);
    }
  });

  it("stamps updatedAt with clock.now() on a successful update", async () => {
    repo.seed(makeMaterial());

    const cmd: UpdateMaterialCommand = { materialId: MATERIAL_ID, name: "Updated Name" };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.updatedAt.toISOString()).toBe(clock.now().toISOString());
    }
  });

  it("persists the patched material so a subsequent findById reflects the changes", async () => {
    repo.seed(makeMaterial());

    const cmd: UpdateMaterialCommand = { materialId: MATERIAL_ID, name: "Persisted Name" };
    await useCase.exec(cmd, ORG);

    const saved = await repo.findById(MATERIAL_ID);
    expect(saved?.props.name).toBe("Persisted Name");
  });

  it("calls save exactly once on a successful update", async () => {
    repo.seed(makeMaterial());

    const cmd: UpdateMaterialCommand = { materialId: MATERIAL_ID, name: "Once" };
    await useCase.exec(cmd, ORG);

    expect(repo.saveCallCount).toBe(1);
  });

  it("allows clearing optional fields to null", async () => {
    repo.seed(makeMaterial({ code: "CU-1-2", description: "Some notes", markupBps: 2000 }));

    const cmd: UpdateMaterialCommand = {
      materialId: MATERIAL_ID,
      code: null,
      description: null,
      markupBps: null,
    };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.code).toBeNull();
      expect(result.value.props.description).toBeNull();
      expect(result.value.props.markupBps).toBeNull();
    }
  });

  it("preserves fields that are not included in the command (undefined = keep current)", async () => {
    repo.seed(makeMaterial({ code: "CU-1-2", taxable: true }));

    const cmd: UpdateMaterialCommand = { materialId: MATERIAL_ID, name: "Changed" };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.code).toBe("CU-1-2");
      expect(result.value.props.taxable).toBe(true);
      expect(result.value.props.name).toBe("Changed");
    }
  });

  it("does not mutate the original material instance (immutability)", async () => {
    const original = makeMaterial();
    repo.seed(original);

    const cmd: UpdateMaterialCommand = { materialId: MATERIAL_ID, name: "Mutated?" };
    await useCase.exec(cmd, ORG);

    expect(original.props.name).toBe("1/2in Copper Pipe");
  });
});
