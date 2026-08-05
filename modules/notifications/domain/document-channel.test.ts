import { describe, it, expect } from "vitest";
import { isOk } from "@mallet/shared/types";
import { pickDocumentChannel } from "./document-channel";

const PHONE = "+17045550134";
const EMAIL = "dana@example.com";

describe("pickDocumentChannel", () => {
  it("texts when the customer has a phone and the shop may text", () => {
    const r = pickDocumentChannel({ phone: PHONE, email: EMAIL, smsAllowed: true });
    expect(isOk(r) && r.value).toBe("sms");
  });

  it("emails when there is no phone", () => {
    const r = pickDocumentChannel({ phone: null, email: EMAIL, smsAllowed: true });
    expect(isOk(r) && r.value).toBe("email");
  });

  it("emails — NOT texts — when the org's 10DLC campaign is not active", () => {
    // Falling back is not a bypass of the SMS gate: an unapproved org never sends SMS from here.
    const r = pickDocumentChannel({ phone: PHONE, email: EMAIL, smsAllowed: false });
    expect(isOk(r) && r.value).toBe("email");
  });

  it("texts when a phone is on file and no email is — SMS first, the customer is holding it", () => {
    const r = pickDocumentChannel({ phone: PHONE, email: null, smsAllowed: true });
    expect(isOk(r) && r.value).toBe("sms");
  });

  it("refuses, naming BOTH halves, when texting is blocked and there is no email", () => {
    const r = pickDocumentChannel({ phone: PHONE, email: null, smsAllowed: false });
    expect(isOk(r)).toBe(false);
    if (isOk(r)) return;
    expect(r.error.message).toContain("texting isn't approved");
    expect(r.error.message).toContain("no email on file");
  });

  it("refuses when the customer has neither contact field", () => {
    const r = pickDocumentChannel({ phone: null, email: null, smsAllowed: true });
    expect(isOk(r)).toBe(false);
    if (isOk(r)) return;
    expect(r.error.message).toBe("this customer has no phone or email on file");
  });

  it("treats an empty string as absent, not as a destination", () => {
    const r = pickDocumentChannel({ phone: "", email: "", smsAllowed: true });
    expect(isOk(r)).toBe(false);
  });
});
