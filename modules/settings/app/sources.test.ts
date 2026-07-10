import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, FixedClock, isOk, type OrgId } from "@mallet/shared/types";
import { FakeSettingsRepository } from "./get-settings.test";
import { CreateSourceUseCase, UpdateSourceUseCase, RemoveSourceUseCase } from "./sources";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const fixedIds = (id: string) => ({ newId: () => id });

describe("LeadSource use-cases", () => {
  let repo: FakeSettingsRepository;
  let clock: FixedClock;

  beforeEach(() => {
    repo = new FakeSettingsRepository();
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
  });

  it("create: rejects empty label", async () => {
    const uc = new CreateSourceUseCase(repo, fixedIds("s1"));
    const r = await uc.exec({ label: "  " }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "validation") expect(r.error.field).toBe("label");
  });

  it("create: rejects a duplicate label (case-insensitive)", async () => {
    await repo.createSource({ id: "s1", orgId: ORG, label: "Google", position: 0 });
    const uc = new CreateSourceUseCase(repo, fixedIds("s2"));
    const r = await uc.exec({ label: "google" }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("conflict");
  });

  it("create: appends a new source", async () => {
    const uc = new CreateSourceUseCase(repo, fixedIds("s1"));
    const r = await uc.exec({ label: "Yard sign" }, ORG);
    expect(isOk(r)).toBe(true);
    expect(repo.sources).toHaveLength(1);
  });

  it("remove: not-found returns NotFound", async () => {
    const uc = new RemoveSourceUseCase(repo, clock);
    const r = await uc.exec({ id: "nope" }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });

  it("update: patches label", async () => {
    await repo.createSource({ id: "s1", orgId: ORG, label: "Google", position: 0 });
    const uc = new UpdateSourceUseCase(repo, clock);
    const r = await uc.exec({ id: "s1", label: "Google Ads" }, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.label).toBe("Google Ads");
  });
});
