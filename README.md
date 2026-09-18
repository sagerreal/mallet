# Mallet

Mallet is an AI-native operating system for service businesses in the trades:
lead → quote → dispatch → invoice, with an AI voice front desk that answers the phone.
Live at [trymallet.com](https://trymallet.com).

This repo collects the three Mallet codebases in one place for review. Each folder was a
separate repository and its full commit history was merged in with `git subtree`, so
`git log -- app/` (etc.) shows how each part evolved.

| Folder | What it is | Stack |
|---|---|---|
| [`app/`](app/) | The product. Multi-tenant SaaS, modular monolith, ~2,100 commits. | TypeScript, Next.js (App Router), tRPC + Zod, Supabase Postgres with Row-Level Security, Drizzle migrations, Stripe Connect, Twilio voice/SMS, Vapi AI front desk, Inngest workflows, Vercel |
| [`mobile/`](mobile/) | Native shells. A Capacitor wrapper for iOS/Android, and a standalone SwiftUI RoomPlan scanner used to test measurement accuracy. | Swift, SwiftUI, Capacitor |
| [`site/`](site/) | Marketing site and interactive product demo. No build step. | Static HTML/CSS/JS, Vercel |

## Where to start

- **Architecture and boundaries:** [`app/README.md`](app/README.md)
- **Tenant isolation:** Postgres RLS keyed on `org_id`, enforced at the database, with the
  runtime app role set `NOBYPASSRLS`. See the migrations under `app/` and the notes in
  [`app/.env.example`](app/.env.example).
- **Telephony and the AI front desk:** the Twilio and Vapi modules under `app/modules/`
  and `app/app/api/frontdesk/`.
- **Accounting sync:** `app/modules/accounting-sync/` (QuickBooks Online).

## Secrets

No credentials are committed. Configuration is via environment variables; every key is
documented with a blank value in [`app/.env.example`](app/.env.example).

## License

All rights reserved. Shared for review purposes.
