# Mallet Core Design Principles

Canonical constitution. Binding on all contributors and agentic workers. One page.
Source of truth — replaces `.superpowers/sdd/design-principles.md` (old, untracked path).

---

## Architecture

- **SOLID + Hexagonal modules.** Each module lives in `modules/<domain>/{domain,app,infra,api}` +
  barrel `index.ts`. The barrel is the only legal import seam (enforced by ESLint). Template:
  `modules/companies/`.
- **Dependency Inversion.** Use-cases depend on repository interfaces, not Drizzle directly.
  All wiring happens at composition root (the tRPC router factory), not inside domain or app layers.
- **Ports / Repository pattern.** Repositories are interfaces defined in `domain/`; Drizzle impls
  live in `infra/`. Business logic never touches the DB directly.
- **DTO ≠ Domain.** API layer emits DTOs (Zod-validated, serializable). Domain objects are
  immutable value objects created with `create → Result`. Never pass a domain object across a
  module boundary; map at the api layer.

## Validation

- **Validate at every boundary.** Zod on all tRPC inputs, domain `create()` returns `Result` (no
  throws for expected validation failures), repos validate org scope.
- **Fail fast, loudly.** Missing required config → throw at startup. Unexpected state → log full
  context + surface a clear error. Never silently swallow.

## Tenant Safety (non-negotiable)

- **Org id from principal only.** `ctx.principal.orgId` — never from client input.
- **RLS on every tenant table.** Hand-written migration: `ENABLE ROW LEVEL SECURITY` +
  `FORCE ROW LEVEL SECURITY` + `FOR ALL USING/WITH CHECK (org_id = current_org_id())`.
  drizzle-kit does NOT emit RLS — you must add it manually.
- **Composite FKs on child tables.** `(org_id, parent_id) → parent(org_id, id)`.
- **Repos also filter `eq(orgId)` explicitly.** Defense-in-depth + index utilization.

## Resilience

- **YAGNI scoping.** Resilience patterns (circuit breaker, retry, timeout) apply ONLY to real
  external calls: Storage, Twilio, Stripe, Resend, Anthropic. NOT to Postgres/Drizzle — the DB
  is local and reliable within a request; wrapper overhead there is noise, not safety.
- The existing `call()` + `CircuitBreaker` helpers in `platform/` are the standard; reuse them
  for new external adapters, do not reinvent.

## Immutability

- Domain objects are immutable after creation. Use-cases return new values; no in-place mutation.
- Store writes: optimistic update → server mutation → reconcile from returned DTO → rollback on
  failure. `adoptEstimate` / `adoptInvoice` pattern — never re-persist a server-returned DTO
  via an add* action.

## Testing

- **Test pyramid:** unit (domain + use-case mocks) > integration (Drizzle against live Supabase)
  > E2E (behavioral Playwright, not screenshot scripts).
- Gate: 80% statements / 75% branches. Current baseline ~94/85 — do not regress.
- TDD for logic changes: write failing test first, then implement.

## Code Size

- **Functions < 50 lines; files < 800 lines.** Extract when you exceed these. Files drifting to
  1000+ lines are a signal to split by sub-domain.
- High cohesion, low coupling. Feature folders, not type folders.

## Money

- **Integer cents** in DB and domain (`Money` = branded number). `{cents, currency}` in DTOs.
  Dollars in the Zustand store. Conversions live in `lib/store/dto-mapper.ts` only.
- Rates and discounts in basis points (bps).

## Other non-negotiables

- **Soft-delete only** (`deleted_at`). Never hard-delete tenant data.
- **No floating UI.** Panels expand in-flow; suggestion lists render under their input, in-flow.
- **UI copy is functional.** Errors name the actual problem and next step — not chatty.
- No demo/sample/seed data — everything DB-backed. No dead buttons: wire a control or delete it.
- Structured logging with context (pino). Background paths: log and degrade gracefully. Interactive
  paths: surface `PRECONDITION_FAILED` when a channel is unconfigured.
