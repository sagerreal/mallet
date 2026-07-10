import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, FixedClock, isOk, type OrgId } from "@mallet/shared/types";
import { FakeSettingsRepository } from "./get-settings.test";
import {
  CreatePricebookUseCase, UpdatePricebookUseCase, RemovePricebookUseCase,
} from "./pricebook";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const fixedIds = (id: string) => ({ newId: () => id });

describe("Pricebook use-cases", () => {
  let repo: FakeSettingsRepository;
  let clock: FixedClock;

  beforeEach(() => {
    repo = new FakeSettingsRepository();
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
  });

  it("create: rejects an empty label", async () => {
    const uc = new CreatePricebookUseCase(repo, fixedIds("p1"));
    const r = await uc.exec({ label: "  ", unitPriceCents: 100, costCents: 0 }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "validation") expect(r.error.field).toBe("label");
  });

  it("create: mints an id and appends", async () => {
    const uc = new CreatePricebookUseCase(repo, fixedIds("p1"));
    const r = await uc.exec({ label: "Camera", unitPriceCents: 28500, costCents: 0 }, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.id).toBe("p1");
    expect(repo.pricebook).toHaveLength(1);
  });

  it("update: not-found returns NotFound", async () => {
    const uc = new UpdatePricebookUseCase(repo, clock);
    const r = await uc.exec({ id: "nope", label: "x" }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });

  it("update: forwards clock.now() as updatedAt to the repository", async () => {
    await repo.createPricebook({ id: "p1", orgId: ORG, label: "Camera", unitPriceCents: 28500, costCents: 0, position: 0 });
    const uc = new UpdatePricebookUseCase(repo, clock);
    const r = await uc.exec({ id: "p1", label: "Updated Camera" }, ORG);
    expect(isOk(r)).toBe(true);
    expect(repo.lastPricebookUpdatedAt).toEqual(new Date("2026-07-09T12:00:00Z"));
  });

  it("remove: archives an existing row", async () => {
    await repo.createPricebook({ id: "p1", orgId: ORG, label: "Camera", unitPriceCents: 1, costCents: 0, position: 0 });
    const uc = new RemovePricebookUseCase(repo, clock);
    const r = await uc.exec({ id: "p1" }, ORG);
    expect(isOk(r)).toBe(true);
    expect(repo.pricebook).toHaveLength(0);
  });
});
