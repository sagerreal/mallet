import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load secrets from .env.local (gitignored). Migrations authenticate as the table
// owner (postgres) via DATABASE_URL — never the least-privilege runtime role.
config({ path: ".env.local" });

// Drizzle migrations-as-code. Schema lives per-module under shared/db/schema.
// DATABASE_URL points at the Supabase Postgres (Project Settings → Database → Connection string).
export default defineConfig({
  schema: "./shared/db/schema/*",
  out: "./shared/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
});
