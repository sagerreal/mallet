import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, FixedClock, isOk, type OrgId } from "@mallet/shared/types";
import { FakeSettingsRepository } from "./get-settings.test";
import {
  CreateLaborRateUseCase, UpdateLaborRateUseCase, RemoveLaborRateUseCase,
} from "./labor-rates";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const fixedIds = (id: string) => ({ newId: () => id });

describe("LaborRate use-cases", () => {
  let repo: FakeSettingsRepository;
  let clock: FixedClock;

  beforeEach(() => {
    repo = new FakeSettingsRepository();
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
  });

  it("create: rejects empty label", async () => {
    const uc = new CreateLaborRateUseCase(repo, fixedIds("l1"));
    const r = await uc.exec({ label: " ", rateCentsPerHour: 17000 }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "validation") expect(r.error.field).toBe("label");
  });

  it("create: appends with minted id", async () => {
    const uc = new CreateLaborRateUseCase(repo, fixedIds("l1"));
    const r = await uc.exec({ label: "Standard", rateCentsPerHour: 17000 }, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.rateCentsPerHour).toBe(17000);
  });

  it("create: defaults kind to hourly when omitted", async () => {
    const uc = new CreateLaborRateUseCase(repo, fixedIds("l1"));
    const r = await uc.exec({ label: "Standard", rateCentsPerHour: 17000 }, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.kind).toBe("hourly");
  });

  it("create: persists kind: flat_fee", async () => {
    const uc = new CreateLaborRateUseCase(repo, fixedIds("l1"));
    const r = await uc.exec(
      { label: "Diagnostic fee", rateCentsPerHour: 9500, kind: "flat_fee" },
      ORG,
    );
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.kind).toBe("flat_fee");
      expect(repo.laborRates[0]?.kind).toBe("flat_fee");
    }
  });

  it("create: rejects an invalid kind", async () => {
    const uc = new CreateLaborRateUseCase(repo, fixedIds("l1"));
    const r = await uc.exec(
      { label: "Standard", rateCentsPerHour: 17000, kind: "bogus" },
      ORG,
    );
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "validation") expect(r.error.field).toBe("kind");
    expect(repo.laborRates).toHaveLength(0);
  });

  it("remove: refuses to delete the last active rate (conflict)", async () => {
    await repo.createLaborRate({ id: "l1", orgId: ORG, label: "Standard", rateCentsPerHour: 17000, kind: "hourly", position: 0 });
    const uc = new RemoveLaborRateUseCase(repo, clock);
    const r = await uc.exec({ id: "l1" }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("conflict");
    expect(repo.laborRates).toHaveLength(1);
  });

  it("remove: deletes when more than one remains", async () => {
    await repo.createLaborRate({ id: "l1", orgId: ORG, label: "Standard", rateCentsPerHour: 17000, kind: "hourly", position: 0 });
    await repo.createLaborRate({ id: "l2", orgId: ORG, label: "Emergency", rateCentsPerHour: 25500, kind: "hourly", position: 1 });
    const uc = new RemoveLaborRateUseCase(repo, clock);
    const r = await uc.exec({ id: "l2" }, ORG);
    expect(isOk(r)).toBe(true);
    expect(repo.laborRates).toHaveLength(1);
  });

  it("update: not-found returns NotFound", async () => {
    const uc = new UpdateLaborRateUseCase(repo, clock);
    const r = await uc.exec({ id: "nope", label: "x" }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });

  it("update: forwards clock.now() as updatedAt to the repository", async () => {
    await repo.createLaborRate({ id: "l1", orgId: ORG, label: "Standard", rateCentsPerHour: 17000, kind: "hourly", position: 0 });
    const uc = new UpdateLaborRateUseCase(repo, clock);
    const r = await uc.exec({ id: "l1", label: "Standard Plus" }, ORG);
    expect(isOk(r)).toBe(true);
    expect(repo.lastLaborRateUpdatedAt).toEqual(new Date("2026-07-09T12:00:00Z"));
  });

  it("update: changes kind from hourly to flat_fee", async () => {
    await repo.createLaborRate({ id: "l1", orgId: ORG, label: "Standard", rateCentsPerHour: 17000, kind: "hourly", position: 0 });
    const uc = new UpdateLaborRateUseCase(repo, clock);
    const r = await uc.exec({ id: "l1", kind: "flat_fee" }, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.kind).toBe("flat_fee");
  });

  it("update: keeps existing kind when omitted", async () => {
    await repo.createLaborRate({ id: "l1", orgId: ORG, label: "Standard", rateCentsPerHour: 17000, kind: "flat_fee", position: 0 });
    const uc = new UpdateLaborRateUseCase(repo, clock);
    const r = await uc.exec({ id: "l1", label: "Standard Plus" }, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.kind).toBe("flat_fee");
  });

  it("update: rejects an invalid kind", async () => {
    await repo.createLaborRate({ id: "l1", orgId: ORG, label: "Standard", rateCentsPerHour: 17000, kind: "hourly", position: 0 });
    const uc = new UpdateLaborRateUseCase(repo, clock);
    const r = await uc.exec({ id: "l1", kind: "bogus" }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "validation") expect(r.error.field).toBe("kind");
  });
});
