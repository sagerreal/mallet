import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// Helpers to build a Twilio-signed request without a live account.
// Twilio signature: HMAC-SHA1 over authToken of (url + sorted-params).
// ---------------------------------------------------------------------------
const AUTH_TOKEN = "test_auth_token_abc123";
const ACCOUNT_SID = "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const sorted = Object.keys(params).sort();
  let str = url;
  for (const key of sorted) {
    str += key + (params[key] ?? "");
  }
  return createHmac("sha1", authToken).update(Buffer.from(str)).digest("base64");
}

function buildRequest(url: string, params: Record<string, string>, signature: string): Request {
  const body = new URLSearchParams(params).toString();
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
    },
    body,
  });
}

// ---------------------------------------------------------------------------
// Module-level mocks. All must be hoisted before any import of the route.
// ---------------------------------------------------------------------------
vi.mock("@mallet/shared/config", () => ({
  loadConfig: () => ({
    TWILIO_AUTH_TOKEN: AUTH_TOKEN,
    TWILIO_ACCOUNT_SID: ACCOUNT_SID,
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    DATABASE_URL: "postgres://localhost/test",
    APP_DATABASE_URL: "postgres://localhost/test",
    NODE_ENV: "test" as const,
  }),
}));

const mockExec = vi.fn().mockResolvedValue({});
const mockFindOrgIdByTwilioNumber = vi.fn();

vi.mock("@mallet/messaging", () => {
  return {
    DrizzleOrgByNumberReader: vi.fn().mockImplementation(function () {
      return { findOrgIdByTwilioNumber: mockFindOrgIdByTwilioNumber };
    }),
    DrizzleMessageRepository: vi.fn().mockImplementation(function () {
      return {};
    }),
    DrizzleLeadByPhoneReader: vi.fn().mockImplementation(function () {
      return {};
    }),
    DrizzleLeadUnreadMarker: vi.fn().mockImplementation(function () {
      return { markLeadUnread: vi.fn().mockResolvedValue(true) };
    }),
    RecordInboundMessageUseCase: vi.fn().mockImplementation(function () {
      return { exec: mockExec };
    }),
  };
});

vi.mock("@mallet/shared/db/tx", () => ({
  withTenant: vi.fn().mockImplementation(function (_orgId: unknown, fn: (tx: unknown) => Promise<unknown>) {
    return fn({});
  }),
}));

vi.mock("@mallet/shared/observability", () => ({
  runWithContext: vi.fn().mockImplementation(function (_ctx: unknown, fn: () => Promise<unknown>) {
    return fn();
  }),
  enrichRequestContext: vi.fn(),
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/trpc/di", () => ({
  getAppDeps: () => ({ ids: { newId: () => "test-uuid-1234" } }),
}));

vi.mock("@mallet/shared/ports", () => ({
  uuidGenerator: { newId: () => "test-uuid-1234" },
}));

// ---------------------------------------------------------------------------
// Import the route AFTER mocks.
// ---------------------------------------------------------------------------
import { POST } from "./route";

const THE_URL = "https://trymallet.com/api/webhooks/twilio";
const THE_TO = "+15005550006";
const THE_FROM = "+15555550199";
const ORG_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("POST /api/webhooks/twilio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindOrgIdByTwilioNumber.mockResolvedValue(ORG_ID);
    mockExec.mockResolvedValue({});
  });

  it("rejects an invalid signature with 403 and does NOT touch the database", async () => {
    const params = { From: THE_FROM, To: THE_TO, Body: "Hello", MessageSid: "SM123" };
    const req = buildRequest(THE_URL, params, "bad-signature");
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(mockFindOrgIdByTwilioNumber).not.toHaveBeenCalled();
  });

  it("returns 200 TwiML and records the message for a valid signature + known org", async () => {
    const params = { From: THE_FROM, To: THE_TO, Body: "Hello from customer", MessageSid: "SM456" };
    const sig = twilioSignature(AUTH_TOKEN, THE_URL, params);
    const req = buildRequest(THE_URL, params, sig);
    const res = await POST(req);

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("<Response");
    expect(mockFindOrgIdByTwilioNumber).toHaveBeenCalledWith(THE_TO);
    expect(mockExec).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG_ID,
        fromPhone: THE_FROM,
        toPhone: THE_TO,
        body: "Hello from customer",
        providerSid: "SM456",
      }),
    );
  });

  it("returns 200 (empty TwiML) when no org matches the To-number, without recording anything", async () => {
    mockFindOrgIdByTwilioNumber.mockResolvedValue(null);

    const params = { From: THE_FROM, To: "+19999999999", Body: "Wrong number", MessageSid: "SM789" };
    const sig = twilioSignature(AUTH_TOKEN, THE_URL, params);
    const req = buildRequest(THE_URL, params, sig);
    const res = await POST(req);

    // Unknown number → 200 (don't tell Twilio to retry; message intentionally dropped).
    expect(res.status).toBe(200);
    expect(mockExec).not.toHaveBeenCalled();
  });
});
