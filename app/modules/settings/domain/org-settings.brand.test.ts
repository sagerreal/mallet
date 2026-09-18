import { describe, it, expect } from "vitest";
import { isOk } from "@mallet/shared/types";
import { OrgSettings, type OrgSettingsProps } from "./org-settings";
import { baseSettingsProps } from "./org-settings.fixtures";

// baseSettingsProps() returns a valid OrgSettingsProps for the org, with brand
// fields defaulted (name "My Business", others null).
const make = (o: Partial<OrgSettingsProps> = {}): OrgSettings => {
  const r = OrgSettings.create(baseSettingsProps(o));
  if (!isOk(r)) throw new Error(`create failed: ${JSON.stringify(r.error)}`);
  return r.value;
};

describe("OrgSettings brand fields default to null on create", () => {
  it("has null brand optionals when not supplied", () => {
    const s = make();
    expect(s.props.brandTagline).toBeNull();
    expect(s.props.brandSite).toBeNull();
    expect(s.props.brandColor).toBeNull();
    expect(s.props.brandLogoUrl).toBeNull();
    expect(s.props.brandInitials).toBeNull();
  });

  it("has brandName equal to the supplied value", () => {
    const s = make({ brandName: "My Business" });
    expect(s.props.brandName).toBe("My Business");
  });

  it("rejects a blank brandName on create", () => {
    const r = OrgSettings.create(baseSettingsProps({ brandName: "  " }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("validation");
      expect(r.error.field).toBe("brandName");
    }
  });
});

describe("OrgSettings.patchBrand", () => {
  const NOW = new Date("2026-07-10T12:00:00Z");

  it("patches all brand fields and stamps updatedAt", () => {
    const r = make().patchBrand(
      {
        name: "Rivera Plumbing",
        tagline: "Licensed & insured",
        site: "riveraplumbing.com",
        color: "#9C5B34",
        logoUrl: null,
        initials: "RP",
      },
      NOW,
    );
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.brandName).toBe("Rivera Plumbing");
      expect(r.value.props.brandTagline).toBe("Licensed & insured");
      expect(r.value.props.brandSite).toBe("riveraplumbing.com");
      expect(r.value.props.brandColor).toBe("#9C5B34");
      expect(r.value.props.brandInitials).toBe("RP");
      expect(r.value.props.updatedAt.toISOString()).toBe(NOW.toISOString());
    }
  });

  it("undefined keeps current, explicit null clears optionals", () => {
    const seeded = make({ brandTagline: "old", brandColor: "#111111" });
    const r = seeded.patchBrand({ tagline: null }, NOW); // color untouched
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.brandTagline).toBeNull();
      expect(r.value.props.brandColor).toBe("#111111");
    }
  });

  it("rejects a blank brand name (maps to NOT NULL orgs.name)", () => {
    const r = make().patchBrand({ name: "   " }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("validation");
      expect(r.error.field).toBe("brandName");
    }
  });
});
