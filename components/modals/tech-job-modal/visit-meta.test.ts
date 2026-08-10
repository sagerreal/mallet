/**
 * The pager's one date line. The rule that matters: every state names the DAY exactly once, and a
 * duration is printed only when it is a fact — booked (~) before the visit, measured after it,
 * never a fabricated zero.
 */
import { describe, it, expect } from "vitest";
import { visitPagerMeta, onSiteHours } from "./visit-meta";
import type { Visit } from "@/lib/store/types";

const at = (h: number, m: number): string => new Date(2026, 7, 10, h, m, 0).toISOString();

const visit = (over: Partial<Visit> = {}): Visit =>
  ({
    id: "v1",
    date: "2026-08-07",
    techId: "tech-1",
    start: 12,
    dur: 1.5,
    status: "scheduled",
    ...over,
  }) as Visit;

describe("visitPagerMeta", () => {
  it("scheduled: day · start · booked length", () => {
    expect(visitPagerMeta(visit())).toBe("Fri 7 · 12:00 PM · ~1h 30m");
  });

  it("on the way: day · on the way — no invented arrival window", () => {
    expect(visitPagerMeta(visit({ status: "enroute", enrouteAt: at(11, 41) }))).toBe(
      "Fri 7 · on the way",
    );
  });

  it("on site: the elapsed figure leads, the booking demoted to context", () => {
    const v = visit({ status: "onsite", startedAt: at(12, 19) });
    expect(visitPagerMeta(v, new Date(2026, 7, 10, 13, 39))).toBe("on site 1h 20m · ~1h 30m booked");
  });

  it("on site with an unreadable stamp pair: since-time, never a negative elapsed", () => {
    const v = visit({ status: "onsite", startedAt: at(12, 19) });
    expect(visitPagerMeta(v, new Date(2026, 7, 10, 11, 0))).toBe("on site since 12:19p");
  });

  it("done: day · measured time on site", () => {
    const v = visit({ status: "done", startedAt: at(12, 19), completedAt: at(13, 19) });
    expect(visitPagerMeta(v)).toBe("Fri 7 · 1h on site");
  });

  it("done without stamps: the day alone — absent means unrecorded, never zero", () => {
    expect(visitPagerMeta(visit({ status: "done" }))).toBe("Fri 7");
  });

  it("a return trip with no slot is waiting on a time", () => {
    expect(visitPagerMeta(visit({ date: null, techId: null, start: null } as Partial<Visit>))).toBe(
      "waiting on a time",
    );
  });

  it("a dated day with nobody on it is waiting on a tech — a different, checkable claim", () => {
    expect(visitPagerMeta(visit({ techId: null } as Partial<Visit>))).toBe(
      "Fri 7 — waiting on a tech",
    );
  });
});

describe("onSiteHours", () => {
  it("measures completed − started", () => {
    expect(onSiteHours(visit({ startedAt: at(12, 0), completedAt: at(13, 30) }))).toBe(1.5);
  });

  it("is null on a missing or backwards pair", () => {
    expect(onSiteHours(visit({ completedAt: at(13, 0) }))).toBeNull();
    expect(onSiteHours(visit({ startedAt: at(14, 0), completedAt: at(13, 0) }))).toBeNull();
  });
});
