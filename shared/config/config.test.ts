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
});
