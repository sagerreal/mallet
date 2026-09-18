/**
 * components/modals/skill-hint.test.ts
 * Unit tests for the pure skillHintFor helper.
 * All test cases use plain objects — no React, no store, no I/O.
 */
import { describe, it, expect } from "vitest";
import { skillHintFor } from "./skill-hint";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

type MinTech = { id: string; skills: readonly string[] };

function tech(id: string, ...skills: string[]): MinTech {
  return { id, skills };
}

/** Constant-zero load (no bookings). */
function noLoad(_techId: string): number {
  return 0;
}

/** Load function that returns a known value per tech id. */
function loadMap(map: Record<string, number>) {
  return (techId: string) => map[techId] ?? 0;
}

// ---------------------------------------------------------------------------
// noRequirement
// ---------------------------------------------------------------------------

describe("skillHintFor — noRequirement", () => {
  it("returns noRequirement when required is null", () => {
    const hint = skillHintFor({
      required: null,
      selectedTechId: "t1",
      techs: [tech("t1", "Plumber")],
      loadOf: noLoad,
    });
    expect(hint.state).toBe("noRequirement");
    expect(hint.missing).toEqual([]);
    expect(hint.suggestedTechId).toBeNull();
  });

  it("returns noRequirement when required is an empty array", () => {
    const hint = skillHintFor({
      required: [],
      selectedTechId: "t1",
      techs: [tech("t1", "Plumber")],
      loadOf: noLoad,
    });
    expect(hint.state).toBe("noRequirement");
  });
});

// ---------------------------------------------------------------------------
// selectedQualified
// ---------------------------------------------------------------------------

describe("skillHintFor — selectedQualified", () => {
  it("returns selectedQualified when the selected tech holds all required certs", () => {
    const hint = skillHintFor({
      required: ["Backflow", "Journeyman Plumber"],
      selectedTechId: "t1",
      techs: [tech("t1", "Backflow", "Journeyman Plumber", "Gas")],
      loadOf: noLoad,
    });
    expect(hint.state).toBe("selectedQualified");
    expect(hint.missing).toEqual([]);
    expect(hint.suggestedTechId).toBeNull();
  });

  it("uses casefold comparison via the gate (mixed-case certs)", () => {
    const hint = skillHintFor({
      required: ["BACKFLOW"],
      selectedTechId: "t1",
      techs: [tech("t1", "backflow")],
      loadOf: noLoad,
    });
    expect(hint.state).toBe("selectedQualified");
  });
});

// ---------------------------------------------------------------------------
// selectedMissing with a suggestion
// ---------------------------------------------------------------------------

describe("skillHintFor — selectedMissing with suggestion", () => {
  it("returns selectedMissing + the lightest qualified tech when the selected tech lacks certs", () => {
    const t1 = tech("t1", "Gas"); // selected — missing Backflow
    const t2 = tech("t2", "Backflow", "Gas"); // qualified
    const hint = skillHintFor({
      required: ["Backflow"],
      selectedTechId: "t1",
      techs: [t1, t2],
      loadOf: noLoad,
    });
    expect(hint.state).toBe("selectedMissing");
    expect(hint.missing).toEqual(["Backflow"]);
    expect(hint.suggestedTechId).toBe("t2");
  });

  it("DISCRIMINATING CASE: a loaded-but-qualified tech beats an idle unqualified one", () => {
    // t1 is selected and missing the cert.
    // t2 is qualified but loaded (4 h). t3 is idle but unqualified.
    // Expectation: t2 is suggested (only qualified candidate), not t3.
    const t1 = tech("t1"); // selected, no certs
    const t2 = tech("t2", "Backflow"); // qualified, loaded
    const t3 = tech("t3"); // unqualified, idle
    const hint = skillHintFor({
      required: ["Backflow"],
      selectedTechId: "t1",
      techs: [t1, t2, t3],
      loadOf: loadMap({ t2: 4 }),
    });
    expect(hint.state).toBe("selectedMissing");
    expect(hint.suggestedTechId).toBe("t2"); // qualified beats idle unqualified
  });

  it("picks the LIGHTEST qualified tech when multiple are qualified", () => {
    const t1 = tech("t1"); // selected, no certs
    const t2 = tech("t2", "Drain"); // qualified, heavy
    const t3 = tech("t3", "Drain"); // qualified, lighter
    const hint = skillHintFor({
      required: ["Drain"],
      selectedTechId: "t1",
      techs: [t1, t2, t3],
      loadOf: loadMap({ t2: 6, t3: 2 }),
    });
    expect(hint.suggestedTechId).toBe("t3");
  });

  it("breaks ties by roster order (first in techs array wins)", () => {
    const t1 = tech("t1"); // selected, no certs
    const t2 = tech("t2", "Gas"); // qualified, 0 load — first in roster
    const t3 = tech("t3", "Gas"); // qualified, 0 load — second
    const hint = skillHintFor({
      required: ["Gas"],
      selectedTechId: "t1",
      techs: [t1, t2, t3],
      loadOf: noLoad, // both t2/t3 are idle
    });
    expect(hint.suggestedTechId).toBe("t2");
  });

  it("suggestion is NEVER the selected tech", () => {
    const t1 = tech("t1", "Backflow"); // selected AND qualified — should trigger selectedQualified
    // Confirm selected-qualified path returns no suggestion
    const hint = skillHintFor({
      required: ["Backflow"],
      selectedTechId: "t1",
      techs: [t1],
      loadOf: noLoad,
    });
    expect(hint.state).toBe("selectedQualified");
    expect(hint.suggestedTechId).toBeNull();
  });

  it("suggestion is never the currently-selected tech even when they're qualified", () => {
    // t1 selected (missing cert), t1 also appears again — guard against self-suggest
    const t1 = tech("t1"); // missing cert
    const t2 = tech("t2", "Electrical"); // qualified
    const hint = skillHintFor({
      required: ["Electrical"],
      selectedTechId: "t1",
      techs: [t1, t2],
      loadOf: noLoad,
    });
    expect(hint.suggestedTechId).toBe("t2");
    expect(hint.suggestedTechId).not.toBe("t1");
  });

  it("reports exact missing certs from the T1 gate (not a comparison of its own)", () => {
    const t1 = tech("t1", "Gas"); // has Gas, missing Backflow + Drain
    const t2 = tech("t2", "Backflow", "Drain", "Gas"); // fully qualified
    const hint = skillHintFor({
      required: ["Backflow", "Drain", "Gas"],
      selectedTechId: "t1",
      techs: [t1, t2],
      loadOf: noLoad,
    });
    expect(hint.state).toBe("selectedMissing");
    expect(hint.missing).toEqual(["Backflow", "Drain"]);
  });
});

// ---------------------------------------------------------------------------
// noneQualified
// ---------------------------------------------------------------------------

describe("skillHintFor — noneQualified", () => {
  it("returns noneQualified when nobody on the team holds the required cert", () => {
    const t1 = tech("t1", "Gas");
    const t2 = tech("t2");
    const hint = skillHintFor({
      required: ["Backflow"],
      selectedTechId: "t1",
      techs: [t1, t2],
      loadOf: noLoad,
    });
    expect(hint.state).toBe("noneQualified");
    expect(hint.suggestedTechId).toBeNull();
    expect(hint.missing).toEqual(["Backflow"]);
  });

  it("returns noneQualified when techs array is empty", () => {
    const hint = skillHintFor({
      required: ["Electrical"],
      selectedTechId: null,
      techs: [],
      loadOf: noLoad,
    });
    expect(hint.state).toBe("noneQualified");
    expect(hint.suggestedTechId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// No tech selected
// ---------------------------------------------------------------------------

describe("skillHintFor — no tech selected", () => {
  it("suggests the best qualified tech when no tech is selected", () => {
    const t2 = tech("t2", "Backflow"); // qualified
    const hint = skillHintFor({
      required: ["Backflow"],
      selectedTechId: null,
      techs: [t2],
      loadOf: noLoad,
    });
    expect(hint.state).toBe("selectedMissing");
    expect(hint.suggestedTechId).toBe("t2");
    // missing = the full required list when no tech is selected
    expect(hint.missing).toEqual(["Backflow"]);
  });

  it("returns noneQualified with missing=required when no tech selected and nobody qualifies", () => {
    const hint = skillHintFor({
      required: ["HVAC"],
      selectedTechId: null,
      techs: [tech("t1", "Gas")],
      loadOf: noLoad,
    });
    expect(hint.state).toBe("noneQualified");
    expect(hint.missing).toEqual(["HVAC"]);
    expect(hint.suggestedTechId).toBeNull();
  });

  it("picks the lightest when no tech selected and multiple qualify", () => {
    const t1 = tech("t1", "Gas"); // loaded
    const t2 = tech("t2", "Gas"); // idle
    const hint = skillHintFor({
      required: ["Gas"],
      selectedTechId: null,
      techs: [t1, t2],
      loadOf: loadMap({ t1: 5 }),
    });
    expect(hint.suggestedTechId).toBe("t2");
  });
});
