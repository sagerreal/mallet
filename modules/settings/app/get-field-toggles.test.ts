import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, isOk, type OrgId } from "@mallet/shared/types";
import { GetFieldTogglesUseCase } from "./get-field-toggles";
import { defaultBooking } from "./default-booking";
import { FakeSettingsRepository } from "./get-settings.test";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");

/**
 * The narrow read that lets a TECHNICIAN's phone know whether the shop measures.
 *
 * `v1.settings.get` is ownerOrOffice and returns the whole configuration, so the field layout can
 * only mount its hydrator for owner/office — which meant a tech's copy of the measurement flag was
 * stuck at its placeholder for the whole session, and the field scan row never rendered on the one
 * surface built for the field. This use-case exists so that read can be `anyRole` without any
 * office configuration crossing over.
 */
describe("GetFieldTogglesUseCase", () => {
  let repo: FakeSettingsRepository;

  beforeEach(() => {
    repo = new FakeSettingsRepository();
  });

  it("reports the org's measurement flag", async () => {
    const result = await new GetFieldTogglesUseCase(repo).exec(ORG);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.measurementEstimating).toBe(false);
  });

  it("reports it as ON when the org measures", async () => {
    const seeded = await repo.getConfig(ORG, defaultBooking);
    const patched = seeded.patch({ measurementEstimating: true }, new Date());
    expect(isOk(patched)).toBe(true);
    if (!isOk(patched)) return;
    repo.config = patched.value;

    const result = await new GetFieldTogglesUseCase(repo).exec(ORG);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.measurementEstimating).toBe(true);
  });

  /**
   * The security property, asserted structurally rather than trusted to review: whatever else is
   * on the settings aggregate, this use-case hands back exactly one key. Anything added here
   * becomes readable by every technician in the org, so the shape is the contract.
   */
  it("returns ONE field — no office configuration can leak through it", async () => {
    const result = await new GetFieldTogglesUseCase(repo).exec(ORG);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(Object.keys(result.value)).toEqual(["measurementEstimating"]);
  });
});
