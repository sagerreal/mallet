/**
 * lib/doc-fonts.test.ts — the one list, actually one.
 */
import { describe, it, expect } from "vitest";
import { DOC_FONTS, DOC_FONT_KEYS, docFontStack } from "./doc-fonts";
import { readFileSync } from "node:fs";

describe("DOC_FONTS", () => {
  it("keeps the legacy keys — snapshots already in the wild name them", () => {
    for (const key of ["basic", "serif", "mono"]) expect(DOC_FONT_KEYS).toContain(key);
  });

  it("resolves an unknown or absent key to the default face, never a crash", () => {
    expect(docFontStack(undefined)).toBe("");
    expect(docFontStack("comic-sans")).toBe("");
    expect(docFontStack("georgia")).toContain("Georgia");
  });

  it("every stack ends in a generic family — a public page must not depend on a face existing", () => {
    for (const font of DOC_FONTS) {
      if (!font.stack) continue;
      expect(font.stack).toMatch(/(sans-serif|serif|monospace)$/);
    }
  });

  it("matches the transport's font enum key for key — one list, enforced", () => {
    const router = readFileSync("modules/quoting/api/estimate-router.ts", "utf8");
    for (const key of DOC_FONT_KEYS) {
      expect(router, `estimate-router font enum is missing "${key}"`).toContain(`"${key}"`);
    }
  });

  it("matches the domain's PRESENTATION_FONTS key for key", () => {
    const domain = readFileSync("modules/quoting/domain/presentation-snapshot.ts", "utf8");
    for (const key of DOC_FONT_KEYS) {
      expect(domain, `PRESENTATION_FONTS is missing "${key}"`).toContain(`"${key}"`);
    }
  });
});
