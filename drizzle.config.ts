import "dotenv/config";
import { defineConfig } from "drizzle-kit";

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
