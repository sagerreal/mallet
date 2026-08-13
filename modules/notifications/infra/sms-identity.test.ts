import { describe, expect, it } from "vitest";
import { pickSmsIdentity } from "./sms-identity";

/**
 * modules/notifications/infra/sms-identity.test.ts
 * The precedence Jobber documents, asserted directly:
 *   own line when it is usable → shared line until then → nothing.
 */

const ORG = { fromNumber: "+16693413343", messagingServiceSid: "MG-org" };
const SHARED = { fromNumber: "+18335132209", messagingServiceSid: "MG-shared" };
const NONE = { fromNumber: null, messagingServiceSid: null };

describe("pickSmsIdentity", () => {
  it("uses the shop's own line once it has one", () => {
    expect(pickSmsIdentity(ORG, SHARED)).toEqual({ ...ORG, source: "org" });
  });

  /**
   * The day-one case, and the reason the shared line exists at all: A2P vetting runs 5-7 business
   * days and can run weeks. A shop that cannot invoice for a month is a shop that churns.
   */
  it("uses the shared line while the shop has no number of its own", () => {
    expect(pickSmsIdentity(NONE, SHARED)).toEqual({ ...SHARED, source: "shared" });
  });

  it("answers nothing when neither line is configured", () => {
    // The caller degrades to the logging stub, so assertDelivered still refuses to claim a send.
    expect(pickSmsIdentity(NONE, NONE)).toBeNull();
  });

  /**
   * A NUMBER WITHOUT A SERVICE IS NOT AN IDENTITY. The campaign attaches to the Messaging Service;
   * a bare `from` is filtered as unregistered traffic even with an approved campaign and the
   * number sitting in that service's pool. That is exactly how every Mallet text failed before
   * A2P, and falling through to a fully-registered shared line beats repeating it.
   */
  it("skips the shop's own number when it has no Messaging Service yet", () => {
    const halfway = { fromNumber: "+16693413343", messagingServiceSid: null };
    expect(pickSmsIdentity(halfway, SHARED)).toEqual({ ...SHARED, source: "shared" });
  });

  it("skips a shared line that has a number but no service", () => {
    const halfway = { fromNumber: "+18335132209", messagingServiceSid: null };
    expect(pickSmsIdentity(NONE, halfway)).toBeNull();
  });

  it("treats undefined the same as null — an unset env var is not an identity", () => {
    expect(pickSmsIdentity(NONE, { fromNumber: undefined, messagingServiceSid: undefined })).toBeNull();
  });

  it("says which line it picked, so a log can tell them apart", () => {
    expect(pickSmsIdentity(ORG, SHARED)?.source).toBe("org");
    expect(pickSmsIdentity(NONE, SHARED)?.source).toBe("shared");
  });
});
