import { describe, it, expect } from "vitest";
import { bookVisitTool, bookVisitInput } from "./book-visit";

// M1: the JSON schema the LLM sees and the zod input MUST agree, so a model that omits an optional
// field doesn't dead-end to the generic fallback. urgency is OPTIONAL (defaults "normal") and NOT
// in required[]; problem is REQUIRED and IS in required[]. These tests pin that parity + the parse
// behaviour the runner relies on (it calls `tool.input.safeParse(args)` before `handle`).

const VALID = {
  caller_name: "Jane Doe",
  phone: "(925) 555-0182",
  address: "12 Elm St, Pleasanton",
  service_name: "Leaky faucet",
  lane: "repair" as const,
  problem: "kitchen faucet dripping",
  slot_date: "2026-07-16",
  slot_start: "08:00" as const,
  urgency: "normal" as const,
};

describe("bookVisitInput ↔ JSON schema parity (M1)", () => {
  const schemaRequired = (bookVisitTool.parameters as { required: string[] }).required;

  it("the JSON-schema required[] is exactly the 8 caller-supplied fields (urgency excluded)", () => {
    expect([...schemaRequired].sort()).toEqual(
      [
        "address",
        "caller_name",
        "lane",
        "phone",
        "problem",
        "service_name",
        "slot_date",
        "slot_start",
      ].sort(),
    );
    expect(schemaRequired).not.toContain("urgency");
    expect(schemaRequired).not.toContain("slot_window");
    expect(schemaRequired).toContain("problem");
  });

  it("parses a fully-specified input", () => {
    const parsed = bookVisitInput.safeParse(VALID);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.urgency).toBe("normal");
  });

  it("input OMITTING urgency parses and defaults to 'normal' (books as a normal call)", () => {
    const { urgency, ...withoutUrgency } = VALID;
    void urgency;
    const parsed = bookVisitInput.safeParse(withoutUrgency);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.urgency).toBe("normal");
  });

  it("an explicit urgency='emergency' is preserved (the exception still escalates)", () => {
    const parsed = bookVisitInput.safeParse({ ...VALID, urgency: "emergency" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.urgency).toBe("emergency");
  });

  it("input OMITTING problem fails validation cleanly (runner → spoken fallback, no crash)", () => {
    const { problem, ...withoutProblem } = VALID;
    void problem;
    const parsed = bookVisitInput.safeParse(withoutProblem);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.includes("problem"))).toBe(true);
    }
  });

  it("rejects a garbage urgency value (closed enum still enforced)", () => {
    const parsed = bookVisitInput.safeParse({ ...VALID, urgency: "whenever" });
    expect(parsed.success).toBe(false);
  });
});
