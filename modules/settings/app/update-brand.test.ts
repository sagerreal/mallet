import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, FixedClock, isOk, type OrgId } from "@mallet/shared/types";
import { OrgSettings } from "../domain/org-settings";
import { baseSettingsProps } from "../domain/org-settings.fixtures";
import type { OrgSettingsRepository } from "../domain/org-settings-repository";
import { UpdateBrandUseCase, type OrgNameWriter, type UpdateBrandCommand } from "./update-brand";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");

class FakeSettingsRepo implements OrgSettingsRepository {
  saved: OrgSettings | null = null;
  constructor(private readonly current: OrgSettings) {}
  async getOrCreate(): Promise<OrgSettings> { return this.saved ?? this.current; }
  async save(s: OrgSettings): Promise<void> { this.saved = s; }
}

class FakeOrgNameWriter implements OrgNameWriter {
  calls: { orgId: string; name: string }[] = [];
  async setName(orgId: string, name: string): Promise<void> { this.calls.push({ orgId, name }); }
}

describe("UpdateBrandUseCase", () => {
  let clock: FixedClock;
  let repo: FakeSettingsRepo;
  let names: FakeOrgNameWriter;
  let useCase: UpdateBrandUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-10T12:00:00Z"));
    const seed = OrgSettings.create(baseSettingsProps());
    if (!isOk(seed)) throw new Error("seed failed");
    repo = new FakeSettingsRepo(seed.value);
    names = new FakeOrgNameWriter();
    useCase = new UpdateBrandUseCase(repo, names, clock);
  });

  it("persists brand fields to org_settings and the name to orgs", async () => {
    const cmd: UpdateBrandCommand = {
      name: "Rivera Plumbing",
      tagline: "Licensed & insured",
      site: "riveraplumbing.com",
      color: "#9C5B34",
      logoUrl: null,
      initials: "RP",
    };
    const r = await useCase.exec(cmd, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.brandName).toBe("Rivera Plumbing");
      expect(r.value.props.brandColor).toBe("#9C5B34");
    }
    expect(repo.saved).not.toBeNull();
    expect(names.calls).toEqual([{ orgId: ORG, name: "Rivera Plumbing" }]);
  });

  it("does not write orgs.name when the command omits name", async () => {
    const r = await useCase.exec({ tagline: "New tagline" }, ORG);
    expect(isOk(r)).toBe(true);
    expect(names.calls).toHaveLength(0);
  });

  it("returns a validation error and writes nothing when name is blank", async () => {
    const r = await useCase.exec({ name: "   " }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
    expect(repo.saved).toBeNull();
    expect(names.calls).toHaveLength(0);
  });
});
