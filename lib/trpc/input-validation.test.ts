/**
 * lib/trpc/input-validation.test.ts
 *
 * A tRPC INPUT rejection carries the serialized Zod issue array as its message, and BAD_REQUEST is
 * a pass-through code — so a shop owner who typed one character too many in a settings field was
 * shown `[{"code":"too_big","maximum":200,"path":["label"], …}]`. These tests pin the one place
 * that turns those issues into a sentence, and the one predicate that recognises them.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  INPUT_VALIDATION_FIELD,
  inputValidationMessage,
  isInputValidationError,
  zodIssuesOf,
} from "./input-validation";

/** The cause tRPC hands the error formatter when a procedure's input fails to parse. */
function issuesFor(schema: z.ZodType, value: unknown) {
  const parsed = schema.safeParse(value);
  if (parsed.success) throw new Error("schema accepted the value — the fixture is wrong");
  return parsed.error;
}

describe("zodIssuesOf", () => {
  it("finds the issues on a Zod rejection", () => {
    const cause = issuesFor(z.object({ body: z.string().max(1600) }), { body: "x".repeat(1601) });

    expect(zodIssuesOf(cause)?.length).toBe(1);
  });

  it("returns null for every other cause, so nothing else is rewritten", () => {
    expect(zodIssuesOf(new Error("this customer already has that number"))).toBeNull();
    expect(zodIssuesOf({ field: "unfinishedDays", message: "still open" })).toBeNull();
    expect(zodIssuesOf(undefined)).toBeNull();
    // An object carrying a non-array `issues` is not a Zod error.
    expect(zodIssuesOf({ issues: "nope" })).toBeNull();
  });
});

describe("inputValidationMessage", () => {
  it("names the field and the cap when one value is too long", () => {
    const cause = issuesFor(z.object({ body: z.string().max(1600) }), { body: "x".repeat(1601) });

    const message = inputValidationMessage(zodIssuesOf(cause) ?? []);

    expect(message).toBe("Body is too long — 1600 characters maximum.");
  });

  it("reads the cap off a nested path too", () => {
    const cause = issuesFor(
      z.object({ rows: z.array(z.object({ label: z.string().max(200) })) }),
      { rows: [{ label: "x".repeat(201) }] },
    );

    expect(inputValidationMessage(zodIssuesOf(cause) ?? [])).toBe("Label is too long — 200 characters maximum.");
  });

  it("names the fields to look at when the problem isn't length", () => {
    const cause = issuesFor(
      z.object({ unitPriceCents: z.number(), name: z.string() }),
      { unitPriceCents: null, name: 7 },
    );

    const message = inputValidationMessage(zodIssuesOf(cause) ?? []);

    expect(message).toContain("unit price cents");
    expect(message).toContain("name");
    expect(message).toMatch(/try again/i);
  });

  it("never leaks the serialized issues, whatever the shape", () => {
    const cause = issuesFor(z.object({ body: z.string().min(1) }), { body: "" });

    const message = inputValidationMessage(zodIssuesOf(cause) ?? []);

    expect(message).not.toMatch(/[[\]{}]|"code"|too_small|invalid_type/);
  });

  it("still says something when the issues carry no path at all", () => {
    const cause = issuesFor(z.string(), 7);

    const message = inputValidationMessage(zodIssuesOf(cause) ?? []);

    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toMatch(/[[\]{}]/);
  });
});

describe("isInputValidationError", () => {
  it("recognises the tag the formatter stamps on the wire", () => {
    expect(isInputValidationError({ data: { code: "BAD_REQUEST", [INPUT_VALIDATION_FIELD]: true } })).toBe(true);
  });

  it("still recognises a raw serialized payload — a direct caller never meets the formatter", () => {
    const raw = new Error('[{"code":"invalid_type","expected":"number","path":["rows",0,"cost"]}]');

    expect(isInputValidationError(raw)).toBe(true);
  });

  it("leaves a hand-authored domain refusal alone", () => {
    expect(isInputValidationError(new Error("This customer already has that number."))).toBe(false);
    expect(isInputValidationError({ data: { code: "BAD_REQUEST" }, message: "Pick a customer first." })).toBe(false);
  });
});
