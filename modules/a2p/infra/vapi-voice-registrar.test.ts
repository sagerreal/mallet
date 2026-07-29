import { describe, it, expect, vi } from "vitest";
import { VapiVoiceRegistrar, type VapiHttpTransport } from "./vapi-voice-registrar";
import { isOk } from "@mallet/shared/types";

const SERVER_URL = "https://app.trymallet.com/api/frontdesk/vapi";

const make = (t: VapiHttpTransport) =>
  new VapiVoiceRegistrar("vapi_key", SERVER_URL, "AC_test", "twilio_token", "secret", t);

const okTransport = (): VapiHttpTransport => ({ post: vi.fn(async () => ({ status: 201, body: { id: "pn_1" } })) });

describe("VapiVoiceRegistrar", () => {
  it("imports the number with the shared webhook and NO assistantId", async () => {
    // No assistantId is the design: Vapi asks Mallet for an assistant per call, so one webhook
    // serves every shop and no playbook is duplicated outside the database.
    const t = okTransport();
    const r = await make(t).register({ phoneNumber: "+17815550123" });

    expect(isOk(r)).toBe(true);
    const [path, body] = (t.post as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(path).toBe("/phone-number");
    expect(body).toMatchObject({
      provider: "twilio",
      number: "+17815550123",
      twilioAccountSid: "AC_test",
      server: { url: SERVER_URL, secret: "secret" },
    });
    expect(body).not.toHaveProperty("assistantId");
  });

  it("treats an already-imported number as success", async () => {
    // Provisioning retries. A second import must not report a broken line that is in fact working.
    const t: VapiHttpTransport = { post: vi.fn(async () => ({ status: 409, body: { message: "Number already exists" } })) };
    expect(isOk(await make(t).register({ phoneNumber: "+17815550123" }))).toBe(true);
  });

  it("treats a 400 whose message says duplicate as success too", async () => {
    // Vapi does not always use 409 for this.
    const t: VapiHttpTransport = {
      post: vi.fn(async () => ({ status: 400, body: { message: ["number is already in use"] } })),
    };
    expect(isOk(await make(t).register({ phoneNumber: "+17815550123" }))).toBe(true);
  });

  it("reports a real failure rather than pretending voice works", async () => {
    const t: VapiHttpTransport = { post: vi.fn(async () => ({ status: 500, body: { message: "boom" } })) };
    expect(isOk(await make(t).register({ phoneNumber: "+17815550123" }))).toBe(false);
  });

  it("returns an error rather than throwing when the network dies", async () => {
    // Signup calls this transitively; an exception escaping here would fail the signup.
    const t: VapiHttpTransport = { post: vi.fn(async () => { throw new Error("ECONNRESET"); }) };
    expect(isOk(await make(t).register({ phoneNumber: "+17815550123" }))).toBe(false);
  });

  it("omits the secret when none is configured", async () => {
    const t = okTransport();
    await new VapiVoiceRegistrar("k", SERVER_URL, "AC", "tok", undefined, t).register({ phoneNumber: "+1781" });
    const [, body] = (t.post as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((body as { server: Record<string, unknown> }).server).not.toHaveProperty("secret");
  });
});
