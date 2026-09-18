import { describe, it, expect } from "vitest";
import { resolveSettingsTab, SET_TABS, DEFAULT_SET_TAB } from "./settings-tabs";

/**
 * The Settings deep-link contract.
 *
 * The two cases that matter most are not typos a developer makes — they are links generated
 * SERVER-SIDE and already in flight: Stripe Connect's onboarding return URL and the QuickBooks OAuth
 * callback. A shop that started connecting its bank account before a deploy comes back after it, and
 * if the name stops resolving it lands on the wrong tab with no idea whether the connection worked.
 */
describe("the links production generates", () => {
  it("lands Stripe's Connect return on the tab that now holds Payments", () => {
    // /settings?tab=payments&connect=return — modules/settings/api/settings-router.ts
    expect(resolveSettingsTab("payments").tab).toBe("integrations");
  });

  it("lands the QuickBooks OAuth callback on the tab that now holds QuickBooks", () => {
    // /settings?tab=quickbooks&qbo=… — app/api/qbo/callback/route.ts
    expect(resolveSettingsTab("quickbooks").tab).toBe("integrations");
  });

  it("keeps every alias resolving to a tab that actually exists", () => {
    // The failure this catches is a rename: an alias pointing at a tab nobody removed it with.
    for (const alias of ["workspace", "channels", "sources", "fields", "archive", "payments", "quickbooks"]) {
      const { tab } = resolveSettingsTab(alias);
      expect(tab, `${alias} resolved to nothing`).toBeDefined();
      expect(SET_TABS as readonly string[]).toContain(tab);
    }
  });
});

describe("content that moved off Settings entirely", () => {
  it.each([
    ["pricing", "/pricebook"],
    ["booking", "/frontdesk"],
    ["frontdesk", "/frontdesk"],
  ])("sends ?tab=%s to %s rather than dead-ending", (raw, to) => {
    expect(resolveSettingsTab(raw).redirectTo).toBe(to);
  });

  it("redirects instead of picking a tab — the two are exclusive", () => {
    expect(resolveSettingsTab("pricing").tab).toBeUndefined();
  });
});

describe("the ordinary cases", () => {
  it.each([...SET_TABS])("resolves %s to itself", (t) => {
    expect(resolveSettingsTab(t).tab).toBe(t);
  });

  it("asks for nothing when there is no ?tab=", () => {
    expect(resolveSettingsTab(null)).toEqual({});
  });

  it("leaves an UNKNOWN name alone rather than claiming it meant Workspace", () => {
    // A typo or a link from a future version should leave the page on its default, not silently
    // assert that the default is what was asked for.
    expect(resolveSettingsTab("nonsense")).toEqual({});
    expect(DEFAULT_SET_TAB).toBe("company");
  });
});

describe("the Integrations regroup", () => {
  it("no longer has its own Payments or QuickBooks tab", () => {
    expect(SET_TABS as readonly string[]).not.toContain("payments");
    expect(SET_TABS as readonly string[]).not.toContain("quickbooks");
  });

  it("has exactly the four tabs, in reading order", () => {
    expect([...SET_TABS]).toEqual(["company", "team", "integrations", "you"]);
  });

  it("still answers the old Workspace and Channels links", () => {
    // Both named a tab that no longer exists; a bookmark or a setup-checklist link must not
    // dead-end because the shelf was relabelled.
    expect(resolveSettingsTab("workspace").tab).toBe("company");
    expect(resolveSettingsTab("channels").tab).toBe("company");
  });
});
