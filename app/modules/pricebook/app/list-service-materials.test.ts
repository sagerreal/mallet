import { describe, it, expect, beforeEach } from "vitest";
import { asMaterialId, asOrgId, asServiceId, isOk, type ServiceId } from "@mallet/shared/types";
import { ServiceMaterial } from "../domain/service-material";
import type { ServiceMaterialRepository } from "../domain/service-material";
import {
  ListServiceMaterialsUseCase,
  type ListServiceMaterialsQuery,
} from "./list-service-materials";

// ── constants ─────────────────────────────────────────────────────────────────

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const SERVICE_ID: ServiceId = asServiceId("11111111-1111-1111-1111-111111111111");

const makeServiceMaterial = (materialId: string, quantity: number): ServiceMaterial => {
  const r = ServiceMaterial.create({
    orgId: ORG,
    serviceId: SERVICE_ID,
    materialId: asMaterialId(materialId),
    quantity,
  });
  if (!isOk(r)) throw new Error(`ServiceMaterial.create failed: ${JSON.stringify(r.error)}`);
  return r.value;
};

// ── FakeServiceMaterialRepository ─────────────────────────────────────────────

class FakeServiceMaterialRepository implements ServiceMaterialRepository {
  listForServiceCallCount = 0;
  lastListForServiceArg: ServiceId | null = null;
  private nextResult: ServiceMaterial[] = [];

  setNextResult(rows: ServiceMaterial[]): void {
    this.nextResult = rows;
  }

  async attach(): Promise<void> {
    throw new Error("attach not used in list tests");
  }

  async detach(): Promise<number> {
    throw new Error("detach not used in list tests");
  }

  async listForService(serviceId: ServiceId): Promise<ServiceMaterial[]> {
    this.listForServiceCallCount += 1;
    this.lastListForServiceArg = serviceId;
    return this.nextResult;
  }

  async listForServices(): Promise<ServiceMaterial[]> {
    throw new Error("listForServices not used in list tests");
  }
}

// ── ListServiceMaterialsUseCase ───────────────────────────────────────────────

describe("ListServiceMaterialsUseCase", () => {
  let repo: FakeServiceMaterialRepository;
  let useCase: ListServiceMaterialsUseCase;

  beforeEach(() => {
    repo = new FakeServiceMaterialRepository();
    useCase = new ListServiceMaterialsUseCase(repo);
  });

  it("calls repo.listForService exactly once per exec invocation", async () => {
    const query: ListServiceMaterialsQuery = { serviceId: SERVICE_ID };
    await useCase.exec(query);
    expect(repo.listForServiceCallCount).toBe(1);
  });

  it("forwards the serviceId from the query to repo.listForService", async () => {
    const query: ListServiceMaterialsQuery = { serviceId: SERVICE_ID };
    await useCase.exec(query);
    expect(repo.lastListForServiceArg).toBe(SERVICE_ID);
  });

  it("returns the exact array the repository resolves with", async () => {
    const rows = [
      makeServiceMaterial("33333333-3333-3333-3333-333333333333", 2),
      makeServiceMaterial("44444444-4444-4444-4444-444444444444", 1),
    ];
    repo.setNextResult(rows);

    const result = await useCase.exec({ serviceId: SERVICE_ID });

    expect(result).toBe(rows);
  });

  it("returns an empty array when no materials are attached", async () => {
    repo.setNextResult([]);

    const result = await useCase.exec({ serviceId: SERVICE_ID });

    expect(result).toHaveLength(0);
  });
});
