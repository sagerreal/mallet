import { describe, it, expect } from "vitest";
import { ok, err, validation, notFound, conflict, externalService, unauthorized } from "@mallet/shared/types";
import { dispositionFor } from "./disposition";

describe("dispositionFor", () => {
  it("publishes a successful (ok) result with no last_error", () => {
    expect(dispositionFor(ok(undefined))).toEqual({ mark: "publish", lastError: null });
  });

  it("fails (retries) a RETRYABLE external_service error, recording a safe discriminator", () => {
    expect(dispositionFor(err(externalService("twilio", "To +15555550123 invalid", true)))).toEqual({
      mark: "fail",
      lastError: "external_service:twilio",
    });
  });

  it("publishes-terminal a NON-retryable external_service error (retrying would fail identically)", () => {
    const d = dispositionFor(err(externalService("stripe", "invalid api key", false)));
    expect(d.mark).toBe("publish");
    expect(d.lastError).toBe("external_service:stripe");
  });

  it("publishes-terminal a bad/un-processable event (validation/not_found/conflict/unauthorized)", () => {
    for (const e of [validation("bad", "f"), notFound("invoice"), conflict("nope"), unauthorized()]) {
      const d = dispositionFor(err(e));
      expect(d.mark).toBe("publish"); // terminal — a bad event is not retried forever
      expect(d.lastError).toBe(e.kind);
    }
  });
});
