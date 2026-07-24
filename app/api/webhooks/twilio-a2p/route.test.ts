import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// Helpers to build a Twilio-signed request without a live account.
// Twilio signature: HMAC-SHA1 over authToken of (url + sorted-params).
// Copied from app/api/webhooks/twilio/route.test.ts (the harness this route mirrors).
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
    TWILIO_A2P_STATUS_CALLBACK_URL: undefined,
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    DATABASE_URL: "postgres://localhost/test",
    APP_DATABASE_URL: "postgres://localhost/test",
    NODE_ENV: "test" as const,
  }),
}));

const mockExec = vi.fn().mockResolvedValue({ ok: true, value: { status: "active" } });
const mockFindOrgIdBySid = vi.fn();

vi.mock("@mallet/a2p", () => {
  return {
    DrizzleOrgBySidReader: vi.fn().mockImplementation(function () {
      return { findOrgIdBySid: mockFindOrgIdBySid };
    }),
    DrizzleRegistrationRepository: vi.fn().mockImplementation(function () {
      return {};
    }),
    LoggingA2pGateway: vi.fn().mockImplementation(function () {
      return {};
    }),
    AdvanceA2pRegistrationUseCase: vi.fn().mockImplementation(function () {
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
  getAppDeps: () => ({
    ids: { newId: () => "test-uuid-1234" },
    clock: { now: () => new Date("2026-07-22T00:00:00Z") },
    a2pGateway: undefined,
  }),
}));

// ---------------------------------------------------------------------------
// Import the route AFTER mocks.
// ---------------------------------------------------------------------------
import { POST } from "./route";

const THE_URL = "https://trymallet.com/api/webhooks/twilio-a2p";
const ORG_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BRAND_SID = "BNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

describe("POST /api/webhooks/twilio-a2p", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindOrgIdBySid.mockResolvedValue(ORG_ID);
    mockExec.mockResolvedValue({ ok: true, value: { status: "active" } });
  });

  it("rejects an invalid signature with 403 and does NOT touch the database", async () => {
    const params = { BrandSid: BRAND_SID, Status: "twilio-approved" };
    const req = buildRequest(THE_URL, params, "bad-signature");
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(mockFindOrgIdBySid).not.toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("advances the registration and returns 204 for a valid signature + known SID", async () => {
    const params = { BrandSid: BRAND_SID, Status: "twilio-approved" };
    const sig = twilioSignature(AUTH_TOKEN, THE_URL, params);
    const req = buildRequest(THE_URL, params, sig);
    const res = await POST(req);

    expect(res.status).toBe(204);
    const text = await res.text();
    expect(text).toBe("");
    expect(mockFindOrgIdBySid).toHaveBeenCalledWith(BRAND_SID);
    expect(mockExec).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG_ID }));
  });

  it("returns 204 without calling the use case when no registration matches the SID", async () => {
    mockFindOrgIdBySid.mockResolvedValue(null);

    const params = { BrandSid: "BNunknownunknownunknownunknownuni", Status: "twilio-approved" };
    const sig = twilioSignature(AUTH_TOKEN, THE_URL, params);
    const req = buildRequest(THE_URL, params, sig);
    const res = await POST(req);

    expect(res.status).toBe(204);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("returns 204 even when the use case reports an error (never leaks state)", async () => {
    mockExec.mockResolvedValue({ ok: false, error: { kind: "not_found", message: "gone" } });

    const params = { BrandSid: BRAND_SID, Status: "twilio-approved" };
    const sig = twilioSignature(AUTH_TOKEN, THE_URL, params);
    const req = buildRequest(THE_URL, params, sig);
    const res = await POST(req);

    expect(res.status).toBe(204);
  });
});
