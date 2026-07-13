import { describe, it, expect, beforeEach } from "vitest";
import { asMaterialId, asOrgId, asServiceId, type MaterialId, type OrgId, type ServiceId } from "@mallet/shared/types";
import type { ServiceMaterial, ServiceMaterialRepository } from "../domain/service-material";
import { DetachMaterialUseCase, type DetachMaterialCommand } from "./detach-material";

// ── constants ─────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const SERVICE_ID: ServiceId = asServiceId("11111111-1111-1111-1111-111111111111");
const MATERIAL_ID: MaterialId = asMaterialId("33333333-3333-3333-3333-333333333333");

// ── FakeServiceMaterialRepository ─────────────────────────────────────────────

class FakeServiceMaterialRepository implements ServiceMaterialRepository {
  detachCallCount = 0;
  detachLastArgs: { serviceId: ServiceId; materialId: MaterialId } | null = null;
  private nextDetachResult = 0;

  setNextDetachResult(count: number): void {
    this.nextDetachResult = count;
  }

  async attach(): Promise<void> {
    throw new Error("attach not used in detach tests");
  }

  async detach(serviceId: ServiceId, materialId: MaterialId): Promise<number> {
    this.detachCallCount += 1;
    this.detachLastArgs = { serviceId, materialId };
    return this.nextDetachResult;
  }

  async listForService(): Promise<ServiceMaterial[]> {
    throw new Error("listForService not used in detach tests");
  }

  async listForServices(): Promise<ServiceMaterial[]> {
    throw new Error("listForServices not used in detach tests");
  }
}

// ── DetachMaterialUseCase ─────────────────────────────────────────────────────

describe("DetachMaterialUseCase", () => {
  let repo: FakeServiceMaterialRepository;
  let useCase: DetachMaterialUseCase;

  beforeEach(() => {
    repo = new FakeServiceMaterialRepository();
    useCase = new DetachMaterialUseCase(repo);
  });

  // ── not_found (count === 0) ───────────────────────────────────────────────

  it("returns not_found when the attachment does not exist", async () => {
    repo.setNextDetachResult(0);

    const cmd: DetachMaterialCommand = { serviceId: SERVICE_ID, materialId: MATERIAL_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not_found");
  });

  // ── happy path ────────────────────────────────────────────────────────────

  it("returns { ok: true } when the attachment is successfully detached", async () => {
    repo.setNextDetachResult(1);

    const cmd: DetachMaterialCommand = { serviceId: SERVICE_ID, materialId: MATERIAL_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.ok).toBe(true);
  });

  it("calls detach exactly once with the correct serviceId and materialId", async () => {
    repo.setNextDetachResult(1);

    const cmd: DetachMaterialCommand = { serviceId: SERVICE_ID, materialId: MATERIAL_ID };
    await useCase.exec(cmd, ORG);

    expect(repo.detachCallCount).toBe(1);
    expect(repo.detachLastArgs).toEqual({ serviceId: SERVICE_ID, materialId: MATERIAL_ID });
  });
});
