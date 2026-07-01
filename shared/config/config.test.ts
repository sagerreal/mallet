import { describe, it, expect } from "vitest";
import { loadConfig } from "./index";

const validEnv = {
  NODE_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  DATABASE_URL: "postgresql://localhost/db",
  APP_DATABASE_URL: "postgresql://localhost/db",
} as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("parses a complete environment", () => {
    expect(loadConfig(validEnv).NODE_ENV).toBe("test");
  });

  it("fails fast when a required var is missing", () => {
    const { DATABASE_URL: _omitted, ...incomplete } = validEnv;
    expect(() => loadConfig(incomplete as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it("boots with no Stripe vars (card payments self-disable)", () => {
    const cfg = loadConfig(validEnv);
    expect(cfg.STRIPE_SECRET_KEY).toBeUndefined();
    expect(cfg.STRIPE_WEBHOOK_SECRET).toBeUndefined();
  });

  it("boots with the Stripe secret key but no webhook secret", () => {
    const cfg = loadConfig({ ...validEnv, STRIPE_SECRET_KEY: "sk_test_x" } as NodeJS.ProcessEnv);
    expect(cfg.STRIPE_SECRET_KEY).toBe("sk_test_x");
    expect(cfg.STRIPE_WEBHOOK_SECRET).toBeUndefined();
  });

  it("fails fast on a malformed PUBLIC_APP_URL", () => {
    expect(() =>
      loadConfig({ ...validEnv, PUBLIC_APP_URL: "not-a-url" } as NodeJS.ProcessEnv),
    ).toThrow(/PUBLIC_APP_URL/);
  });

  it("boots with no comms vars (email/sms self-disable to the logging stub)", () => {
    const cfg = loadConfig(validEnv);
    expect(cfg.RESEND_API_KEY).toBeUndefined();
    expect(cfg.EMAIL_FROM).toBeUndefined();
    expect(cfg.TWILIO_ACCOUNT_SID).toBeUndefined();
    expect(cfg.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("captures comms + AI vars when present", () => {
    const cfg = loadConfig({
      ...validEnv,
      RESEND_API_KEY: "re_x",
      EMAIL_FROM: "Mallet <notifications@example.com>",
      TWILIO_ACCOUNT_SID: "ACxxx",
      TWILIO_AUTH_TOKEN: "tok",
      TWILIO_FROM_NUMBER: "+15555550123",
      ANTHROPIC_API_KEY: "sk-ant-x",
    } as NodeJS.ProcessEnv);
    expect(cfg.RESEND_API_KEY).toBe("re_x");
    expect(cfg.EMAIL_FROM).toBe("Mallet <notifications@example.com>");
    expect(cfg.TWILIO_FROM_NUMBER).toBe("+15555550123");
    expect(cfg.ANTHROPIC_API_KEY).toBe("sk-ant-x");
  });
});
