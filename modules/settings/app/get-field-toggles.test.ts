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
  it("returns exactly the allow-listed fields — no office configuration can leak through it", async () => {
    const result = await new GetFieldTogglesUseCase(repo).exec(ORG);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    /**
     * THE ALLOW-LIST, and adding to it is a decision this test exists to force.
     *
     * `timesheetClock` joined it deliberately: it says whether the shop punches a clock, which is
     * a working practice every technician in the org already knows from using the app each
     * morning, and the field surface cannot render correctly without it (`v1.settings.get` is
     * ownerOrOffice and always will be). It is not money, not a credential, and not a permission.
     *
     * The bar for the next one is the same: would a technician learn something from it they could
     * not learn by doing their job? If yes, it does not belong here.
     */
    expect(Object.keys(result.value).sort()).toEqual(["measurementEstimating", "techEditsTimes", "timesheetClock"]);
  });
});
