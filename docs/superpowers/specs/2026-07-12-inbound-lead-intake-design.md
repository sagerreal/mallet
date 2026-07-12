# Inbound Lead Intake — Design

**Status:** Approved (brainstorming) — ready for implementation planning.
**Date:** 2026-07-12
**Author:** Owen + Claude

## Goal

Let a shop capture leads from sources outside a phone call, dropped straight into the pipeline:
1. **Website form** — a Mallet-hosted, shop-branded "request service" form the shop shares as a link or embeds as an iframe.
2. **Angi** and **Thumbtack** marketplace webhooks — each platform POSTs new leads to a per-shop URL.

Yelp and Google LSA are **out of scope** (partner/spend/dev-token gated). An email-parse catch-all is **out of scope** (the real webhooks + form cover it).

## Why (context)

For 1–50-person home-services shops, phone/text is the dominant lead channel (already served by the Twilio number + AI Front Desk). The website "request a quote" form is the next-most-common channel and grows with company size; Angi/Thumbtack are where hungry 1–20 shops fill their pipeline. All three are currently dead "Connect"/"Upload" stubs. This makes them real.

## Architecture — one primitive, three channels

All inbound leads flow through a single path, mirroring the existing Twilio webhook and public-quote-token patterns (no session; resolve org privileged; write inside `withTenant`):

```
POST /api/inbound/{channel}/{token}
  1. validate token format (256-bit hex) — reject early, no DB hit on malformed
  2. ResolveOrgByToken → { orgId, channel } | null   (privileged reader, returns ONLY orgId)  → 404 on miss
  3. channel parser: raw payload → NormalizedLead { name, phone, email, address, notes, externalId? }
  4. idempotency guard: if (orgId, channel, externalId) already received → skip (return 200)   [webhook retries]
  5. withTenant(orgId) → IngestExternalLeadUseCase → EnsureCustomerUseCase (create + dedupe-by-phone)
  6. record receipt + stamp endpoint.last_lead_at; source = "Website" | "Angi" | "Thumbtack"
```

**Only the parser (step 3) differs per channel.** Adding a future channel = add a parser + register it; the core path, table, and use-case are untouched (Open/Closed).

Tenant isolation is enforced by RLS because every write happens inside `withTenant(orgId)`. The unguessable per-endpoint token is the sole credential (same model as the public quote token) — so the design does not depend on Angi/Thumbtack signing their requests; signature verification is optional defense-in-depth added later without changing the core.

## Data model

Two tables, one migration, hand-written RLS (drizzle-kit does not emit RLS).

```
inbound_endpoints
  id            uuid pk
  org_id        uuid not null → orgs(id)
  channel       text not null   CHECK in ('form','angi','thumbtack')
  token         text not null   -- 64 hex chars, 256-bit, unguessable
  last_lead_at  timestamptz     -- null until first lead arrives ("Connected" = not null)
  created_at    timestamptz not null default now()
  deleted_at    timestamptz     -- soft-delete only
  UNIQUE (org_id, channel)       -- one endpoint per (org, channel)
  UNIQUE (token)                 -- global lookup key; indexed for the resolver

inbound_lead_receipts            -- idempotency ledger (webhooks retry)
  id            uuid pk
  org_id        uuid not null → orgs(id)
  channel       text not null
  external_id   text not null    -- the source's stable lead id (Angi lead id / Thumbtack lead id)
  lead_id       uuid             -- the lead we created/deduped to (nullable; informational)
  created_at    timestamptz not null default now()
  UNIQUE (org_id, channel, external_id)   -- the idempotency key
```

- **Indexes (strategic):** `inbound_endpoints.token` unique index is the hot resolver path (one indexed lookup, no scan). `(org_id, channel)` unique doubles as the settings-list index. Receipts unique `(org_id, channel, external_id)` is the idempotency guard AND its own index.
- **RLS:** both tables get `ENABLE` + `FORCE ROW LEVEL SECURITY` + `FOR ALL USING/WITH CHECK (org_id = current_org_id())`. The token *resolver* runs privileged (no principal yet) and returns only the orgId — least privilege; everything after runs org-scoped under `withTenant`.
- **No N+1:** resolver is a single indexed token lookup; ingest reuses `EnsureCustomerUseCase` (single upsert with `ON CONFLICT`); idempotency is a single `INSERT … ON CONFLICT DO NOTHING`.

## Components (hexagonal, DI, SOLID)

New module `modules/inbound/` following the `modules/companies/` template:

- **domain/**
  - `InboundEndpoint` value object (`create → Result`, validates channel + token format, immutable).
  - `Channel` string-literal union + guard (`'form' | 'angi' | 'thumbtack'`).
  - `NormalizedLead` type — the parser output contract (the seam every channel targets).
  - `InboundEndpointRepository` **port** (interface): `findByToken`, `listByOrg`, `create`, `touchLastLead`, `softDelete`.
  - `LeadReceiptRepository` **port**: `recordIfNew(orgId, channel, externalId, leadId) → boolean` (false = already seen).
- **app/** (use-cases, DI-constructed, return `Result`, functions < 20 lines)
  - `ResolveOrgByToken` — token → `{ orgId, channel } | null`. Runs on the privileged reader (no tenant).
  - `IngestExternalLeadUseCase(ensureCustomer, receipts, endpoints, clock)` — orchestrates parse-result → idempotency guard → `EnsureCustomerUseCase` → receipt + `touchLastLead`. Returns `{ created | deduped | duplicate_ignored }`.
  - `LeadParser` **interface** + one impl per channel (`FormLeadParser`, `AngiLeadParser`, `ThumbtackLeadParser`), each pure `(payload) → Result<NormalizedLead>`. A `parserFor(channel)` registry (Interface Segregation + Open/Closed).
- **infra/**
  - `DrizzleInboundEndpointRepository`, `DrizzleLeadReceiptRepository` (org-scoped, explicit `eq(orgId)` defense-in-depth), and a privileged `DrizzleInboundEndpointResolver` for the no-session token lookup (mirrors `DrizzleOrgByNumberReader`).
  - Mappers: DB row ↔ domain, fail-fast on corrupt rows.
- **api/** — `v1.inbound` tRPC router (`ownerOrOffice`, org from `ctx.principal`): `list` (endpoints + `last_lead_at`), `generate(channel)` (mint token, idempotent — returns existing if present), `rotate(channel)`, `disable(channel)`. DTOs separate from domain.

**Reuse (DRY):** the actual customer write is `EnsureCustomerUseCase` from `modules/customers` — not reimplemented. The token-resolution + `withTenant` pattern is the same one Twilio and public-quote already use.

## Public surfaces

- **Route:** `app/api/inbound/[channel]/[token]/route.ts` (`runtime = nodejs`, `force-dynamic`) — one handler, parser chosen by `channel`. Validates at the boundary (token format, channel enum, payload via Zod per channel); never trusts client-supplied org. Structured logging via `runWithContext`/`enrichRequestContext({ orgId })` (same as Twilio); never logs PII (name/phone/email) — only counts + orgId + channel. Returns 200 on success/duplicate, 400 on malformed payload, 404 on bad token, 403 reserved for future signature checks.
- **Website form page:** `app/(public)/f/[token]/page.tsx` — public, shop-branded (name + brand color resolved via the token, reusing the Branding data). Fields: name (required), phone, email, service address, "what do you need?" (notes). Same-origin POST to `/api/inbound/form/[token]`. Shareable link `…/f/{token}` and one-line `<iframe>` embed.
  - **Spam (defense in depth):** hidden honeypot field + minimum time-to-submit + a per-token fixed-window rate limit (e.g. 20/min) on the form channel. Turnstile/hCaptcha noted as optional later hardening (avoids a new dep/config for v1). Marketplaces are token-gated + idempotent, so their abuse surface is low.

## Settings UI

In `app/(office)/settings/page.tsx` (the "Ways leads reach you" section — **shared file, coordinate with the concurrent Source-list work; edits confined to these two cards**):

- **Lead marketplaces card:** Angi + Thumbtack rows → **"Get webhook URL"** → reveals URL + secret token + copy-paste steps *in-flow* (no floating UI, per house rule). State: `Not set up → Awaiting first lead → Connected · last lead <relative time>` driven by `last_lead_at`. **Yelp + Google LSA:** dead "Connect" buttons replaced with a muted **"Not available yet"** (no dead buttons).
- **New "Website form" card:** "Get your form" → reveals the shareable link + iframe snippet + a live preview link.

## Error handling & resilience (scoped to what this feature actually does)

- **Fail fast for programmer errors** (bad channel constant, corrupt DB row → throw); **graceful degradation for runtime errors** (unknown token → 404 + log; malformed marketplace payload → 400 + log, no crash).
- **No silent failures:** every rejected/duplicate/parse-failure path logs with context.
- **External-call resilience (timeouts/retry/backoff/circuit-breaker): N/A here** — this feature is the *receiver*; it makes no outbound external calls, and per the design principles DB access does not get resilience wrappers. Idempotency (below) covers the retry concern from the *senders'* side.
- **Idempotency:** Angi/Thumbtack retry webhooks; the `inbound_lead_receipts` unique `(org_id, channel, external_id)` guard makes re-delivery a no-op. The form channel has no external id and relies on phone dedupe (a human double-submit is rare; a phoned one dedupes).

## Observability

- Structured logging with request/org context via the existing `runWithContext` + `enrichRequestContext` (as Twilio does). Log events: `inbound.received`, `inbound.created`, `inbound.deduped`, `inbound.duplicate_ignored`, `inbound.rejected_*` — counts only, never PII.
- Health checks already exist (`/api/health`, `/api/ready`). **Standalone metrics dashboards / distributed tracing: YAGNI** for this monolith (the microservices-oriented principles don't apply here).

## API / config

- tRPC is already **versioned** (`v1.*`); consistent tRPC error envelope reused; **DTOs separate from domain**; the settings router supports listing (small fixed set, no pagination needed — at most 3 rows/org). Public routes are versioned by path (`/api/inbound/…`).
- **Config separate from code:** base URL from the validated `PUBLIC_APP_URL` config singleton (as the invite flow does). Tokens are *data* (per-org rows), not config/secrets-in-code.
- Feature flags / gradual rollout: not needed for v1 (behind the settings UI, opt-in per shop by design).

## Testing (test pyramid; behavior not implementation; Arrange-Act-Assert)

- **Unit (many):** each `LeadParser` (valid, missing-name, dirty phone/email → dropped, external id extracted); `IngestExternalLeadUseCase` (create, dedupe, duplicate-ignored via receipt); `InboundEndpoint`/`Channel` domain guards; honeypot + min-time rejection.
- **Integration (some, live DB + RLS):** POST to each channel creates a lead in the *correct* org; **cross-token isolation** (org A's token can't write to org B); dedupe-by-phone; bad token → 404; webhook retry (same `external_id`) → single lead; `v1.inbound.generate/list/rotate/disable` under `ownerOrOffice` + cross-tenant denial.
- **E2E/screenshot (few):** the branded form page renders + submits; the settings reveal panels (marketplace URL, form link/iframe).

## Delivery — phased into two PRs (each independently shippable)

- **PR A — spine + website form:** the two tables + RLS migration, `modules/inbound/` core (domain/app/infra/`v1.inbound`), the `/api/inbound/[channel]/[token]` route with the **form** parser wired, the public branded form page, and the "Website form" settings card. Ships the #1-priority channel end-to-end.
- **PR B — marketplaces:** `AngiLeadParser` + `ThumbtackLeadParser` (mapped from their documented webhook payloads — researched at plan time), registered into the existing route, and the Lead-marketplaces card wiring (Get-webhook-URL + state). No schema change (reuses PR A's tables).

## Design-principles compliance (explicit)

- **SOLID:** SRP (parser vs resolver vs ingest vs repo each one job); Open/Closed (new channel = new parser, core untouched); Liskov/ISP (narrow `LeadParser` + repository ports, `recordIfNew` is a single-purpose port); DI throughout (use-cases constructed with their ports).
- **DRY:** reuses `EnsureCustomerUseCase`, the token→`withTenant` pattern, the config singleton, the brand data.
- **YAGNI:** Yelp/Google/email-parse cut; no captcha dep, no metrics stack, no feature-flag system, no pagination on a ≤3-row list.
- **Repository pattern, transactions, validate-in-domain, no N+1, strategic indexes, idempotency, least privilege, defense in depth, structured logging** — all addressed above.

## Open items resolved at plan time
- Exact Angi + Thumbtack webhook payload JSON shapes (for the parsers) — researched during PR B planning.
- Migration numbering — check `git status shared/db/migrations` for the next free number and re-confirm no open migration PR before generating (single-writer rule).
