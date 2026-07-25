import { describe, it, expect } from "vitest";
import { validation, conflict, notFound } from "@mallet/shared/types";
import { APP_ERROR_FIELD, appErrorField } from "@/lib/trpc/error-map";
import { toTRPCError, withAppErrorTag } from "./errors";

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
