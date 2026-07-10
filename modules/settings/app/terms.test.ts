import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, FixedClock, isOk, type OrgId } from "@mallet/shared/types";
import { FakeSettingsRepository } from "./get-settings.test";
import { CreateTermUseCase, UpdateTermUseCase, RemoveTermUseCase } from "./terms";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const fixedIds = (id: string) => ({ newId: () => id });

describe("JobTerm use-cases", () => {
  let repo: FakeSettingsRepository;
  let clock: FixedClock;

  beforeEach(() => {
    repo = new FakeSettingsRepository();
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
  });

  it("create: rejects empty title or body", async () => {
    const uc = new CreateTermUseCase(repo, fixedIds("t1"));
    const r1 = await uc.exec({ title: " ", body: "x" }, ORG);
    expect(r1.ok).toBe(false);
    const r2 = await uc.exec({ title: "x", body: " " }, ORG);
    expect(r2.ok).toBe(false);
  });

  it("create: appends", async () => {
    const uc = new CreateTermUseCase(repo, fixedIds("t1"));
    const r = await uc.exec({ title: "Warranty", body: "12 months" }, ORG);
    expect(isOk(r)).toBe(true);
    expect(repo.terms).toHaveLength(1);
  });

  it("remove: not-found returns NotFound", async () => {
    const uc = new RemoveTermUseCase(repo, clock);
    const r = await uc.exec({ id: "nope" }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });

  it("update: patches body", async () => {
    await repo.createTerm({ id: "t1", orgId: ORG, title: "Warranty", body: "old", position: 0 });
    const uc = new UpdateTermUseCase(repo, clock);
    const r = await uc.exec({ id: "t1", body: "new" }, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.body).toBe("new");
  });

  it("update: forwards clock.now() as updatedAt to the repository", async () => {
    await repo.createTerm({ id: "t1", orgId: ORG, title: "Warranty", body: "12 months", position: 0 });
    const uc = new UpdateTermUseCase(repo, clock);
    const r = await uc.exec({ id: "t1", title: "Extended Warranty" }, ORG);
    expect(isOk(r)).toBe(true);
    expect(repo.lastTermUpdatedAt).toEqual(new Date("2026-07-09T12:00:00Z"));
  });
});
