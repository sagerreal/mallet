import { describe, it, expect } from "vitest";
import { certAnnotationsFor, armedBannerPhrase } from "./cert-annotations";

// ---------------------------------------------------------------------------
// certAnnotationsFor
// ---------------------------------------------------------------------------

describe("certAnnotationsFor", () => {
  const backflow = { id: "t1", skills: ["Backflow"] };
  const none = { id: "t2", skills: [] };
  const both = { id: "t3", skills: ["Backflow", "Gas"] };

  it("all techs qualify when required is null (no requirement)", () => {
    const res = certAnnotationsFor([backflow, none], null);
    expect(res.get("t1")).toEqual({ qualified: true, missing: [] });
    expect(res.get("t2")).toEqual({ qualified: true, missing: [] });
  });

  it("all techs qualify when required is an empty array", () => {
    const res = certAnnotationsFor([backflow, none], []);
    expect(res.get("t1")).toEqual({ qualified: true, missing: [] });
    expect(res.get("t2")).toEqual({ qualified: true, missing: [] });
  });

  it("marks a tech qualified when they hold all required certs", () => {
    const res = certAnnotationsFor([backflow], ["Backflow"]);
    expect(res.get("t1")).toEqual({ qualified: true, missing: [] });
  });

  it("marks a tech unqualified with the correct missing list", () => {
    const res = certAnnotationsFor([none], ["Backflow"]);
    expect(res.get("t2")).toEqual({ qualified: false, missing: ["Backflow"] });
  });

  it("handles multiple required certs — partial hold = unqualified", () => {
    const partial = { id: "t4", skills: ["Backflow"] };
    const res = certAnnotationsFor([partial, both], ["Backflow", "Gas"]);
    expect(res.get("t4")).toEqual({ qualified: false, missing: ["Gas"] });
    expect(res.get("t3")).toEqual({ qualified: true, missing: [] });
  });

  it("comparison is case-insensitive (normalization via T1 gate)", () => {
    const upper = { id: "t5", skills: ["BACKFLOW"] };
    const res = certAnnotationsFor([upper], ["Backflow"]);
    expect(res.get("t5")).toEqual({ qualified: true, missing: [] });
  });

  it("preserves display casing from the required side in missing list", () => {
    const res = certAnnotationsFor([none], ["Backflow"]);
    expect(res.get("t2")?.missing[0]).toBe("Backflow");
  });

  it("returns an empty map for an empty techs array", () => {
    const res = certAnnotationsFor([], ["Backflow"]);
    expect(res.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// armedBannerPhrase
// ---------------------------------------------------------------------------

describe("armedBannerPhrase", () => {
  const alice = { id: "a1", skills: ["Backflow"] };
  const bob = { id: "b1", skills: [] };

  const zerLoad = (_: string) => 0;
  const nameOf = (id: string) => (id === "a1" ? "Alice Smith" : "Bob Jones");

  it('returns "" when required is null', () => {
    expect(armedBannerPhrase(null, [alice, bob], zerLoad, nameOf)).toBe("");
  });

  it('returns "" when required is empty', () => {
    expect(armedBannerPhrase([], [alice, bob], zerLoad, nameOf)).toBe("");
  });

  it("names the lightest qualified tech when someone qualifies", () => {
    const phrase = armedBannerPhrase(["Backflow"], [alice, bob], zerLoad, nameOf);
    expect(phrase).toBe(" · needs Backflow — Alice is certified");
  });

  it("uses only the first name", () => {
    const phrase = armedBannerPhrase(["Backflow"], [alice], zerLoad, nameOf);
    expect(phrase).toContain("Alice");
    expect(phrase).not.toContain("Smith");
  });

  it("returns no-certified-crew when nobody qualifies", () => {
    const phrase = armedBannerPhrase(["Backflow"], [bob], zerLoad, nameOf);
    expect(phrase).toBe(" · needs Backflow — no certified crew");
  });

  it("picks the tech with the lighter load when there are ties broken by roster", () => {
    const alice2 = { id: "a2", skills: ["Backflow"] };
    const loadOf = (id: string) => (id === "a1" ? 3 : 1); // a2 is lighter
    const nameOf2 = (id: string) => (id === "a1" ? "Alice" : "Charlie");
    const phrase = armedBannerPhrase(["Backflow"], [alice, alice2], loadOf, nameOf2);
    expect(phrase).toContain("Charlie");
  });

  it("joins multiple required certs with ', ' in the phrase", () => {
    const multi = { id: "m1", skills: ["Backflow", "Gas"] };
    const phrase = armedBannerPhrase(["Backflow", "Gas"], [multi], zerLoad, (id) => (id === "m1" ? "Dave" : ""));
    expect(phrase).toBe(" · needs Backflow, Gas — Dave is certified");
  });
});
