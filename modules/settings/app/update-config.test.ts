import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, FixedClock, isOk, type OrgId } from "@mallet/shared/types";
import { FakeSettingsRepository } from "./get-settings.test";
import { GetSettingsUseCase } from "./get-settings";
import { UpdateConfigUseCase } from "./update-config";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");

describe("UpdateConfigUseCase", () => {
  let repo: FakeSettingsRepository;
  let clock: FixedClock;
  let useCase: UpdateConfigUseCase;

  beforeEach(async () => {
    repo = new FakeSettingsRepository();
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    useCase = new UpdateConfigUseCase(repo, clock);
    // ensure a row exists to patch
    await new GetSettingsUseCase(repo).exec(ORG);
  });

  it("patches markup and persists", async () => {
    const result = await useCase.exec({ markupBps: 4200 }, ORG);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.markupBps).toBe(4200);
    expect(repo.config?.props.markupBps).toBe(4200);
  });

  it("patches the booking blob", async () => {
    const result = await useCase.exec(
      { booking: { services: [], notServices: "x", serviceFee: 120, feeCredited: false } },
      ORG,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.booking.serviceFee).toBe(120);
  });

  it("returns a validation error for negative markup and does not persist it", async () => {
    const result = await useCase.exec({ markupBps: -1 }, ORG);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") expect(result.error.field).toBe("markupBps");
    expect(repo.config?.props.markupBps).toBe(3500);
  });
});
