import { describe, it, expect, vi } from "vitest";
import { VapiVoiceRegistrar, type VapiHttpTransport } from "./vapi-voice-registrar";
import { isOk } from "@mallet/shared/types";

const SERVER_URL = "https://app.trymallet.com/api/frontdesk/vapi";

const make = (t: VapiHttpTransport) =>
  new VapiVoiceRegistrar("vapi_key", SERVER_URL, "AC_test", "twilio_token", "secret", t);

/** A transport that accepts the import. get/patch are present but unused on this path. */
const okTransport = (): VapiHttpTransport => ({
  post: vi.fn(async () => ({ status: 201, body: { id: "pn_1" } })),
  get: vi.fn(async () => ({ status: 200, body: [] })),
  patch: vi.fn(async () => ({ status: 200, body: {} })),
});

/** A transport that says "already imported", then hands back the existing row for repair. */
const dupeTransport = (over: Partial<VapiHttpTransport> = {}): VapiHttpTransport => ({
  post: vi.fn(async () => ({ status: 409, body: { message: "Number already exists" } })),
  get: vi.fn(async () => ({ status: 200, body: [{ id: "pn_existing", number: "+17815550123" }] })),
  patch: vi.fn(async () => ({ status: 200, body: {} })),
  ...over,
});

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

  /**
   * ALREADY IMPORTED IS NOT ALREADY CORRECT.
   *
   * This used to return ok() on a duplicate. But "Vapi holds this number" says nothing about
   * whether it points at the right webhook with the right secret — and BOTH live numbers were
   * imported by hand in the dashboard with no server secret, so our own webhook rejected every
   * inbound call 401 before Mallet saw it. Silent, and indistinguishable from the AI not answering.
   */
  it("REPAIRS an already-imported number rather than assuming it is configured", async () => {
    const t = dupeTransport();
    expect(isOk(await make(t).register({ phoneNumber: "+17815550123" }))).toBe(true);

    const [path, body] = (t.patch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(path).toBe("/phone-number/pn_existing");
    expect(body).toMatchObject({ server: { url: SERVER_URL, secret: "secret" } });
  });

  it("repairs on a 400 whose message says duplicate too", async () => {
    // Vapi does not always use 409 for this.
    const t = dupeTransport({
      post: vi.fn(async () => ({ status: 400, body: { message: ["number is already in use"] } })),
    });
    expect(isOk(await make(t).register({ phoneNumber: "+17815550123" }))).toBe(true);
    expect((t.patch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("does not fail provisioning when Vapi will not show us the duplicate", async () => {
    // It claims the number exists but does not list it. Nothing safe to patch; the line may work.
    const t = dupeTransport({ get: vi.fn(async () => ({ status: 200, body: [] })) });
    expect(isOk(await make(t).register({ phoneNumber: "+17815550123" }))).toBe(true);
    expect((t.patch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("reports a failure when the repair itself fails", async () => {
    const t = dupeTransport({ patch: vi.fn(async () => ({ status: 500, body: { message: "boom" } })) });
    expect(isOk(await make(t).register({ phoneNumber: "+17815550123" }))).toBe(false);
  });

  it("reports a real failure rather than pretending voice works", async () => {
    const t = okTransport();
    t.post = vi.fn(async () => ({ status: 500, body: { message: "boom" } }));
    expect(isOk(await make(t).register({ phoneNumber: "+17815550123" }))).toBe(false);
  });

  it("returns an error rather than throwing when the network dies", async () => {
    // Signup calls this transitively; an exception escaping here would fail the signup.
    const t = okTransport();
    t.post = vi.fn(async () => { throw new Error("ECONNRESET"); });
    expect(isOk(await make(t).register({ phoneNumber: "+17815550123" }))).toBe(false);
  });

  it("omits the secret when none is configured", async () => {
    const t = okTransport();
    await new VapiVoiceRegistrar("k", SERVER_URL, "AC", "tok", undefined, t).register({ phoneNumber: "+1781" });
    const [, body] = (t.post as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((body as { server: Record<string, unknown> }).server).not.toHaveProperty("secret");
  });
});
