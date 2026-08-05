import { describe, it, expect } from "vitest";
import { isOk } from "@mallet/shared/types";
import { OrgSettings, type OrgSettingsProps } from "./org-settings";
import { baseSettingsProps } from "./org-settings.fixtures";

// The business-identity subset: what a customer document prints about the shop. Sibling of
// org-settings.brand.test.ts — brand is how the shop LOOKS, this is who it is and how to reach it.
const make = (o: Partial<OrgSettingsProps> = {}): OrgSettings => {
  const r = OrgSettings.create(baseSettingsProps(o));
  if (!isOk(r)) throw new Error(`create failed: ${JSON.stringify(r.error)}`);
  return r.value;
};

const NOW = new Date("2026-08-05T12:00:00Z");

describe("OrgSettings business identity on create", () => {
  it("defaults every business field to null when not supplied", () => {
    const s = make();
    expect(s.props.bizAddress).toBeNull();
    expect(s.props.bizPhone).toBeNull();
    expect(s.props.bizEmail).toBeNull();
    expect(s.props.licenseNumber).toBeNull();
  });

  it("trims surrounding whitespace off supplied values", () => {
    const s = make({
      bizAddress: "  200 Ray St, Pleasanton, CA 94566  ",
      bizPhone: " (925) 555-0100 ",
      bizEmail: "\tbilling@rivera.com\n",
      licenseNumber: "  C36-1029384 ",
    });
    expect(s.props.bizAddress).toBe("200 Ray St, Pleasanton, CA 94566");
    expect(s.props.bizPhone).toBe("(925) 555-0100");
    expect(s.props.bizEmail).toBe("billing@rivera.com");
    expect(s.props.licenseNumber).toBe("C36-1029384");
  });

  it("normalises a blank or whitespace-only value to null", () => {
    // One representation for "not set". A document omits a null row; it cannot omit a row
    // holding a space, which is how a label ends up printed above an empty line.
    const s = make({ bizAddress: "", bizPhone: "   ", bizEmail: "\t", licenseNumber: "\n " });
    expect(s.props.bizAddress).toBeNull();
    expect(s.props.bizPhone).toBeNull();
    expect(s.props.bizEmail).toBeNull();
    expect(s.props.licenseNumber).toBeNull();
  });
});

describe("OrgSettings.patchBusiness", () => {
  it("patches all four fields and stamps updatedAt", () => {
    const r = make().patchBusiness(
      {
        address: "200 Ray St, Pleasanton, CA 94566",
        phone: "(925) 555-0100",
        email: "billing@rivera.com",
        license: "C36-1029384",
      },
      NOW,
    );
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.bizAddress).toBe("200 Ray St, Pleasanton, CA 94566");
      expect(r.value.props.bizPhone).toBe("(925) 555-0100");
      expect(r.value.props.bizEmail).toBe("billing@rivera.com");
      expect(r.value.props.licenseNumber).toBe("C36-1029384");
      expect(r.value.props.updatedAt.toISOString()).toBe(NOW.toISOString());
    }
  });

  it("undefined keeps current, explicit null clears", () => {
    const seeded = make({ bizAddress: "200 Ray St", bizPhone: "(925) 555-0100" });
    const r = seeded.patchBusiness({ phone: null }, NOW); // address untouched
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.bizPhone).toBeNull();
      expect(r.value.props.bizAddress).toBe("200 Ray St");
    }
  });

  it("clearing a field to whitespace stores null, not a space", () => {
    const seeded = make({ licenseNumber: "C36-1029384" });
    const r = seeded.patchBusiness({ license: "   " }, NOW);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.licenseNumber).toBeNull();
  });

  it("accepts license numbers of any shape — no format validation", () => {
    // Texas "M-12345", California "C36-1029384", Florida "CFC1428901", a bare number, a
    // multi-class string. A regex here would reject a valid license and leave a shop unable
    // to put its own license on its own bill.
    const shapes = ["M-12345", "C36-1029384", "CFC1428901", "40218", "MP 1234 / RMP 5678"];
    for (const license of shapes) {
      const r = make().patchBusiness({ license }, NOW);
      expect(isOk(r)).toBe(true);
      if (isOk(r)) expect(r.value.props.licenseNumber).toBe(license);
    }
  });

  it("accepts a phone with an extension and a non-standard email — no format validation", () => {
    const r = make().patchBusiness({ phone: "(925) 555-0100 ext. 12", email: "office+bills@rivera" }, NOW);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.bizPhone).toBe("(925) 555-0100 ext. 12");
      expect(r.value.props.bizEmail).toBe("office+bills@rivera");
    }
  });

  it("returns a NEW instance and leaves the original untouched", () => {
    const seeded = make({ bizAddress: "200 Ray St" });
    const r = seeded.patchBusiness({ address: "1 Market St" }, NOW);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).not.toBe(seeded);
    expect(seeded.props.bizAddress).toBe("200 Ray St");
  });

  it("does not disturb the routing origin — bizAddress and serviceOriginAddress are separate", () => {
    // The whole reason bizAddress exists as its own column: editing what an invoice prints must
    // never move where drive time is measured from.
    const seeded = make({ serviceOriginAddress: "9 Yard Rd, Livermore, CA" });
    const r = seeded.patchBusiness({ address: "200 Ray St, Pleasanton, CA" }, NOW);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.serviceOriginAddress).toBe("9 Yard Rd, Livermore, CA");
      expect(r.value.props.bizAddress).toBe("200 Ray St, Pleasanton, CA");
    }
  });

  it("does not disturb brand fields", () => {
    const seeded = make({ brandName: "Rivera Plumbing", brandSite: "rivera.com" });
    const r = seeded.patchBusiness({ email: "billing@rivera.com" }, NOW);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.brandName).toBe("Rivera Plumbing");
      expect(r.value.props.brandSite).toBe("rivera.com");
    }
  });
});
