import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { orgSettings } from "./org-settings";

// Guards the brand columns Phase 3 adds to the Phase-2 org_settings table.
// Pure schema-shape assertion — no DB needed.
describe("org_settings brand columns", () => {
  const cols = getTableColumns(orgSettings);

  it.each([
    ["brandTagline", "brand_tagline"],
    ["brandSite", "brand_site"],
    ["brandColor", "brand_color"],
    ["brandLogoUrl", "brand_logo_url"],
    ["brandInitials", "brand_initials"],
  ])("exposes %s mapped to %s (text, nullable)", (prop, dbName) => {
    const col = cols[prop as keyof typeof cols];
    expect(col, `${prop} column missing`).toBeDefined();
    expect(col.name).toBe(dbName);
    expect(col.dataType).toBe("string");
    expect(col.notNull).toBe(false);
  });
});
