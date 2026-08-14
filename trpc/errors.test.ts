import { describe, it, expect } from "vitest";
import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { validation, conflict, notFound } from "@mallet/shared/types";
import { APP_ERROR_FIELD, appErrorField } from "@/lib/trpc/error-map";
import { INPUT_VALIDATION_FIELD, isInputValidationError } from "@/lib/trpc/input-validation";
import { toTRPCError, withAppErrorTag, scrubInternalError, flattenInputValidation, formatAppError } from "./errors";

// A domain refusal carries a tag as well as a sentence. These tests follow that tag from the
// use-case's error, through the throw, onto the wire, and back out on the client — because a
// client that has to branch on WHICH rule refused would otherwise be matching prose.
describe("the domain tag survives the transport", () => {
  it("keeps the tag on the thrown error's cause", () => {
    const thrown = toTRPCError(validation("These days still have hours with no end time: 2026-06-30.", "unfinishedDays"));

    expect(thrown.code).toBe("BAD_REQUEST");
    expect(thrown.message).toBe("These days still have hours with no end time: 2026-06-30.");
    expect((thrown.cause as { field?: string }).field).toBe("unfinishedDays");
  });

  it("puts the tag on the error data the client receives", () => {
    const thrown = toTRPCError(validation("nope", "unfinishedDays"));
    const shape = withAppErrorTag({ message: thrown.message, data: { code: "BAD_REQUEST" } }, thrown.cause);

    expect(appErrorField(shape)).toBe("unfinishedDays");
  });

  it("leaves an untagged error's shape exactly as tRPC made it", () => {
    const shape = { message: "gone", data: { code: "NOT_FOUND" } };

    expect(withAppErrorTag(shape, toTRPCError(notFound("gone")).cause)).toBe(shape);
    expect(withAppErrorTag(shape, toTRPCError(conflict("locked")).cause)).toBe(shape);
    expect(withAppErrorTag(shape, undefined)).toBe(shape);
    expect(withAppErrorTag(shape, new Error("plain"))).toBe(shape);
  });

  it("does not lose the code the client already branches on", () => {
    const shape = withAppErrorTag(
      { message: "nope", data: { code: "BAD_REQUEST" } },
      toTRPCError(validation("nope", "unfinishedDays")).cause,
    );

    expect(shape.data).toEqual({ code: "BAD_REQUEST", [APP_ERROR_FIELD]: "unfinishedDays" });
  });
});

// An unhandled throw inside a resolver becomes an INTERNAL_SERVER_ERROR whose message is whatever
// the library that threw wrote. Drizzle writes the SQL: a missing column once put
// `Failed query: select "callback_number" from "users" …` on a customer-facing screen. Nothing an
// unhandled error says is written for a user, so none of it should leave the process.
describe("an internal error says nothing about our internals", () => {
  it("replaces the message on an INTERNAL_SERVER_ERROR", () => {
    const shape = scrubInternalError({
      message: 'Failed query: select "callback_number" from "users" where ("users"."org_id" = $1)',
      data: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(shape.message).not.toMatch(/select|callback_number|users|\$1/);
    expect(shape.message.length).toBeGreaterThan(0);
  });

  it("keeps the code, so the client still maps it to its own copy", () => {
    const shape = scrubInternalError({ message: "boom", data: { code: "INTERNAL_SERVER_ERROR" } });
    expect(shape.data.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("leaves every other error untouched — those sentences were written for users", () => {
    const conflictShape = { message: "add the mobile number Mallet should ring you on", data: { code: "CONFLICT" } };
    expect(scrubInternalError(conflictShape)).toBe(conflictShape);

    const badRequest = { message: "this customer has no phone number on file", data: { code: "BAD_REQUEST" } };
    expect(scrubInternalError(badRequest)).toBe(badRequest);
  });

  it("scrubs regardless of environment — prod-only behaviour is behaviour no test ever sees", () => {
    // The real message is not lost: it is logged server-side by the route handler's onError.
    const shape = scrubInternalError({ message: "ECONNREFUSED 10.0.0.4:5432", data: { code: "INTERNAL_SERVER_ERROR" } });
    expect(shape.message).not.toContain("10.0.0.4");
  });
});

// BAD_REQUEST is a PASS_THROUGH code on the client, which is right for a domain refusal — somebody
// wrote that sentence for a shop owner. An INPUT rejection wears the same code and is not a
// sentence at all: tRPC puts the serialized Zod issue array in the message. That is why a settings
// field one character over its cap, a text over 1600, and a blank price cell in a supplier sheet
// all printed JSON. The split has to happen once, here, or every caller guesses (see the thread
// modal, which reported every BAD_REQUEST as a missing phone number).
describe("an input rejection reads as a sentence, a domain refusal is left alone", () => {
  it("replaces the serialized issues and tags the shape so a client can branch", () => {
    const parsed = z.object({ label: z.string().max(200) }).safeParse({ label: "x".repeat(201) });
    const cause = parsed.success ? null : parsed.error;

    const shape = flattenInputValidation({ message: String(cause), data: { code: "BAD_REQUEST" } }, cause);

    expect(shape.message).toBe("Label is too long — 200 characters maximum.");
    expect(shape.data).toEqual({ code: "BAD_REQUEST", [INPUT_VALIDATION_FIELD]: true });
  });

  it("leaves a hand-authored refusal exactly as it was written", () => {
    const thrown = toTRPCError(validation("Pick a customer from the list before sending.", "leadId"));
    const shape = { message: thrown.message, data: { code: "BAD_REQUEST" } };

    expect(flattenInputValidation(shape, thrown.cause)).toBe(shape);
  });

  // The end-to-end proof. A hand-built cause would keep passing even if tRPC stopped putting the
  // ZodError on `cause` — this rejects real input through a real procedure and feeds the formatter
  // exactly what tRPC feeds it.
  it("holds for the error a real procedure actually throws", async () => {
    const t = initTRPC.create();
    const appRouter = t.router({
      send: t.procedure.input(z.object({ body: z.string().max(1600) })).mutation(() => "sent"),
    });
    const caller = t.createCallerFactory(appRouter)({});

    const error = (await caller
      .send({ body: "x".repeat(1601) })
      .then(() => null, (e: unknown) => e)) as { code: string; message: string; cause: unknown };

    // This is what a shop owner was shown, verbatim.
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toMatch(/too_big|maximum/);

    const shape = formatAppError({
      shape: { message: error.message, data: { code: "BAD_REQUEST" } },
      error,
    } as never) as { message: string; data: Record<string, unknown> };

    expect(shape.message).toBe("Body is too long — 1600 characters maximum.");
    expect(isInputValidationError({ data: shape.data })).toBe(true);
  });
});
