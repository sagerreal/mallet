/**
 * components/modals/site-tracer/held-tracer-params.test.ts
 * The held-mode param contract: `held: true` + a function receiver engages the
 * mode; anything malformed falls back to null (job-mode path) so a trace can
 * never be saved into a missing receiver.
 */

import { describe, it, expect, vi } from "vitest";
import { heldTracerParams } from "./held-tracer-params";

describe("heldTracerParams", () => {
  const onSaveHeld = vi.fn();

  it("narrows well-formed params", () => {
    const result = heldTracerParams({
      held: true,
      address: "12 Elm St",
      existingNames: ["Driveway", 7, "Patio"],
      onSaveHeld,
    });
    expect(result).toEqual({
      address: "12 Elm St",
      existingNames: ["Driveway", "Patio"], // non-strings dropped
      onSaveHeld,
    });
  });

  it("defaults address and existingNames when absent", () => {
    const result = heldTracerParams({ held: true, onSaveHeld });
    expect(result).toEqual({ address: "", existingNames: [], onSaveHeld });
  });

  it("returns null without held: true (job-mode params pass through untouched)", () => {
    expect(heldTracerParams({ jobId: "j1" })).toBeNull();
    expect(heldTracerParams(undefined)).toBeNull();
    expect(heldTracerParams({ held: "true", onSaveHeld })).toBeNull();
  });

  it("returns null when the receiver is missing or not callable — never a save into the void", () => {
    expect(heldTracerParams({ held: true })).toBeNull();
    expect(heldTracerParams({ held: true, onSaveHeld: "cb" })).toBeNull();
  });
});
