import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, isOk, type OrgId } from "@mallet/shared/types";
import { GetBusinessIdentityUseCase } from "./get-business-identity";
import { defaultBooking } from "./default-booking";
import { FakeSettingsRepository } from "./get-settings.test";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");

/**
 * The narrow read that puts WHO BILLED YOU on a customer's invoice.
 *
 * `v1.settings.get` is ownerOrOffice, so the field layout can only mount its hydrator for
 * owner/office — which left a technician's close-out document (the customer's copy of the bill,
 * handed over at the door) with no address, no phone and no licence number. These six facts are
 * already printed on the invoice that customer receives, so this read can be `anyRole`.
 */
describe("GetBusinessIdentityUseCase", () => {
  let repo: FakeSettingsRepository;

  beforeEach(() => {
    repo = new FakeSettingsRepository();
  });

  it("reads the org name and leaves an unfilled document block null, never blank string", async () => {
    const result = await new GetBusinessIdentityUseCase(repo).exec(ORG);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toEqual({
      name: "Test Business",
      address: null,
      phone: null,
      email: null,
      site: null,
      license: null,
    });
  });

  it("projects the four business columns plus the brand website", async () => {
    const seeded = await repo.getConfig(ORG, defaultBooking);
    const patched = seeded.patchBusiness(
      {
        address: "200 Ray St, Pleasanton, CA 94566",
        phone: "(925) 555-0100",
        email: "billing@ridgeline.test",
        license: "C36-1029384",
      },
      new Date(),
    );
    expect(isOk(patched)).toBe(true);
    if (!isOk(patched)) return;
    const withSite = patched.value.patchBrand({ site: "ridgelineplumbing.com" }, new Date());
    expect(isOk(withSite)).toBe(true);
    if (!isOk(withSite)) return;
    repo.config = withSite.value;

    const result = await new GetBusinessIdentityUseCase(repo).exec(ORG);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toEqual({
      name: "Test Business",
      address: "200 Ray St, Pleasanton, CA 94566",
      phone: "(925) 555-0100",
      email: "billing@ridgeline.test",
      site: "ridgelineplumbing.com",
      license: "C36-1029384",
    });
  });

  /**
   * The security property, asserted structurally rather than trusted to review: whatever else sits
   * on the settings aggregate, this use-case hands back exactly these six keys. Anything added here
   * becomes readable by every technician in the org, so the shape IS the contract.
   */
  it("returns SIX fields — no office configuration can leak through it", async () => {
    const result = await new GetBusinessIdentityUseCase(repo).exec(ORG);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(Object.keys(result.value).sort()).toEqual([
      "address",
      "email",
      "license",
      "name",
      "phone",
      "site",
    ]);
  });
});
