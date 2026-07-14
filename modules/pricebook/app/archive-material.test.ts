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
import { ArchiveMaterialUseCase, type ArchiveMaterialCommand } from "./archive-material";

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
  archiveCallCount = 0;
  archiveLastArgs: { id: MaterialId; now: Date } | null = null;

  seed(material: Material): void {
    this.store.set(material.props.id, material);
  }

  async archiveByLead(): Promise<number> { return 0; }
  async archive(id: MaterialId, now: Date): Promise<number> {
    this.archiveCallCount += 1;
    this.archiveLastArgs = { id, now };
    const exists = this.store.has(id);
    if (exists) {
      this.store.delete(id);
      return 1;
    }
    return 0;
  }

  async findById(id: MaterialId): Promise<Material | null> {
    return this.store.get(id) ?? null;
  }

  async save(): Promise<void> {
    throw new Error("save not used in archive tests");
  }

  async create(): Promise<Material> {
    throw new Error("create not used in archive tests");
  }

  async list(
    _page: CursorPage,
    _filter: { search?: string; categoryId?: string | null },
  ): Promise<Paginated<Material>> {
    throw new Error("list not used in archive tests");
  }
}

// ── ArchiveMaterialUseCase ────────────────────────────────────────────────────

describe("ArchiveMaterialUseCase", () => {
  let clock: FixedClock;
  let repo: FakeMaterialRepository;
  let useCase: ArchiveMaterialUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-12T12:00:00Z"));
    repo = new FakeMaterialRepository();
    useCase = new ArchiveMaterialUseCase(repo, clock);
  });

  // ── not_found (count === 0) ───────────────────────────────────────────────

  it("returns not_found error when the material does not exist", async () => {
    const cmd: ArchiveMaterialCommand = { materialId: MISSING_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not_found");
  });

  it("returns not_found error when the material was already archived (count === 0)", async () => {
    const cmd: ArchiveMaterialCommand = { materialId: MATERIAL_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not_found");
  });

  it("passes clock.now() to archive so the deletedAt timestamp is correct", async () => {
    const cmd: ArchiveMaterialCommand = { materialId: MISSING_ID };
    await useCase.exec(cmd, ORG);

    expect(repo.archiveLastArgs?.now.toISOString()).toBe(clock.now().toISOString());
  });

  // ── happy path ────────────────────────────────────────────────────────────

  it("returns { ok: true } when the material is successfully archived", async () => {
    repo.seed(makeMaterial());

    const cmd: ArchiveMaterialCommand = { materialId: MATERIAL_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(true);
    if (isOk(result)) expect(result.value.ok).toBe(true);
  });

  it("calls archive exactly once on the happy path", async () => {
    repo.seed(makeMaterial());

    const cmd: ArchiveMaterialCommand = { materialId: MATERIAL_ID };
    await useCase.exec(cmd, ORG);

    expect(repo.archiveCallCount).toBe(1);
  });

  it("forwards the correct materialId to archive", async () => {
    repo.seed(makeMaterial());

    const cmd: ArchiveMaterialCommand = { materialId: MATERIAL_ID };
    await useCase.exec(cmd, ORG);

    expect(repo.archiveLastArgs?.id).toBe(MATERIAL_ID);
  });
});
