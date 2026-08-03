// lib/geo/zip-timezone.test.ts
import { describe, it, expect } from "vitest";
import { zipToTimezone } from "./zip-timezone";

/**
 * The ZIP is already asked for at /welcome, to give the shop's phone number a local area code.
 * It answers a second question for free: which timezone the shop is in.
 *
 * That matters because org_settings.timezone defaults to America/Los_Angeles, is read by the AI
 * front desk (build-assistant.ts) and the in-app agent's sense of "today" (read-tools.ts), and has
 * no UI. A Boston shop books Pacific times, permanently, and cannot correct it.
 *
 * A ZIP3 table is APPROXIMATE — twelve states straddle a line. The derived value is therefore
 * shown and correctable, never silent. These tests pin the common cases and the shape of the
 * failure, not perfect geography.
 */

describe("zipToTimezone", () => {
  it("puts a Boston plumber on Eastern — the case the default gets wrong", () => {
    expect(zipToTimezone("02189")).toBe("America/New_York");
  });

  it("puts a Bay Area shop on Pacific", () => {
    expect(zipToTimezone("94566")).toBe("America/Los_Angeles");
  });

  it("handles Central, Mountain and the Arizona exception", () => {
    expect(zipToTimezone("60601")).toBe("America/Chicago");     // Chicago
    expect(zipToTimezone("80202")).toBe("America/Denver");      // Denver
    expect(zipToTimezone("85004")).toBe("America/Phoenix");     // Phoenix — no DST
  });

  it("handles the non-contiguous states", () => {
    expect(zipToTimezone("99501")).toBe("America/Anchorage");   // Anchorage
    expect(zipToTimezone("96813")).toBe("Pacific/Honolulu");    // Honolulu
  });

  it("accepts ZIP+4 and surrounding whitespace", () => {
    expect(zipToTimezone(" 02189-1234 ")).toBe("America/New_York");
  });

  // null means "we do not know" — the caller keeps whatever default it had. It must NOT guess.
  it("returns null for input it cannot read, rather than guessing", () => {
    expect(zipToTimezone("")).toBeNull();
    expect(zipToTimezone("abcde")).toBeNull();
    expect(zipToTimezone("123")).toBeNull();
  });

  it("returns null for a ZIP outside the table rather than falling back to Pacific", () => {
    // 005xx is not a real deliverable range; the point is that a gap yields null.
    expect(zipToTimezone("00500")).toBeNull();
  });

  it("only ever returns timezones the runtime actually knows", () => {
    const zips = ["02189", "94566", "60601", "80202", "85004", "99501", "96813", "33101"];
    for (const zip of zips) {
      const tz = zipToTimezone(zip)!;
      expect(() => new Intl.DateTimeFormat("en-US", { timeZone: tz })).not.toThrow();
    }
  });
});
