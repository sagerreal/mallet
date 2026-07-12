# Inbound Lead Intake — PR A (spine + website form) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the inbound-lead spine (per-org token → resolve org → `withTenant` → reuse `EnsureCustomerUseCase`) and the first channel end-to-end: a Mallet-hosted, shop-branded **website lead form** (shareable link + iframe) that drops submissions into the pipeline.

**Architecture:** New hexagonal `modules/inbound/` (domain/app/infra/api) mirroring `modules/companies/`. A single public route `POST /api/inbound/[channel]/[token]` resolves the org from an unguessable token via a privileged `ownerDb` reader (no session — same model as the public quote page + Twilio webhook), then writes inside `withTenant(orgId)`. Only a per-channel **parser** differs; PR A wires the `form` parser. An idempotency ledger makes retried deliveries no-ops. A `v1.inbound` tRPC router lets the settings UI mint/list tokens.

**Tech Stack:** Next.js 16 (App Router), tRPC v11, Drizzle + Supabase Postgres (RLS), Zod, Vitest, `node:crypto` (no new deps).

## Global Constraints

- Working directory: `/Users/owensmacbook/Downloads/prospecting/mallet-app-inbound-leads` (branch `feat/inbound-leads`, off `origin/main`).
- Spec: `docs/superpowers/specs/2026-07-12-inbound-lead-intake-design.md`.
- **No new dependency.** Tokens via `randomBytes(32).toString("hex")` (64 hex, 256-bit) — reuse `modules/quoting/app/draft-estimate.ts:11` (`generatePublicToken`).
- **Tenant safety (non-negotiable):** org id from `ctx.principal.orgId` (tRPC) or resolved from the token via privileged `ownerDb` (public route) — NEVER from client body. All writes run inside `withTenant(orgId)`. Both new tables get hand-written RLS (`ENABLE` + `FORCE ROW LEVEL SECURITY` + `FOR ALL USING/WITH CHECK (org_id = current_org_id())`). Repos also filter `eq(orgId)` explicitly.
- **Privileged reads only for the token bootstrap:** use `ownerDb` (BYPASSRLS) ONLY to resolve `{orgId, channel}` from a token and to read brand for the public form page — minimal columns, no tenant writes. Template: `modules/quoting/infra/drizzle-public-estimate-reader.ts`.
- **Reuse (DRY):** the customer write is `EnsureCustomerUseCase` from `@mallet/customers` — do not reimplement create/dedupe.
- **Migrations single-writer:** next number is `0058` (last applied is `0057_even_gabe_jones`). Before `db:generate`, re-run `gh pr list` and confirm no open PR touches `shared/db/migrations/`. DO NOT run `db:migrate` — generate files only; the controller applies (or Owen).
- **Design principles binding** (`.superpowers/sdd/design-principles.md`): SOLID, DI, repository pattern, DTO≠domain, validate at boundaries, no silent failures, idempotency, least privilege, defense in depth, functions < 20 lines ideal, files < 800, structured logging with context. YAGNI: no captcha dep, no metrics stack, no feature-flag system, no pagination (≤3 endpoints/org).
- **No floating UI**; **UI copy functional, not chatty**; **no dead buttons**.
- Money is not in play in this PR.

## File Structure

**Create — schema + migration:**
- `shared/db/schema/inbound-endpoints.ts` — `inbound_endpoints` + `inbound_lead_receipts` tables
- `shared/db/migrations/0058_*.sql` (+ `meta/0058_snapshot.json`, `meta/_journal.json`) — generated
- `shared/db/migrations/0059_inbound_rls.sql` — hand-written RLS (+ journal entry)

**Create — `modules/inbound/`:**
- `domain/channel.ts` — `Channel` union, `CHANNELS`, `isChannel`
- `domain/normalized-lead.ts` — `NormalizedLead` type
- `domain/inbound-endpoint.ts` — `InboundEndpoint` value object (`create → Result`)
- `domain/inbound-ports.ts` — `InboundEndpointRepository`, `LeadReceiptRepository`, `InboundEndpointResolver` ports
- `domain/lead-parser.ts` — `LeadParser` interface
- `app/parsers/form-parser.ts` — `FormLeadParser`
- `app/parsers/registry.ts` — `parserFor(channel)`
- `app/resolve-org-by-token.ts` — `ResolveOrgByToken`
- `app/ingest-external-lead.ts` — `IngestExternalLeadUseCase`
- `infra/inbound-mapper.ts` — row ↔ domain
- `infra/drizzle-inbound-endpoint-resolver.ts` — privileged `ownerDb` token lookup
- `infra/drizzle-inbound-endpoint-repository.ts` — org-scoped repo (mint/list/touch/soft-delete)
- `infra/drizzle-lead-receipt-repository.ts` — `recordIfNew` (idempotency)
- `api/inbound-dto.ts` — DTOs
- `api/inbound-router.ts` — `v1.inbound` (`list`/`generate`/`rotate`/`disable`)
- `index.ts` — barrel

**Create — public surfaces:**
- `app/api/inbound/[channel]/[token]/route.ts` — POST intake (+ GET brand for `form`)
- `app/(public)/f/[token]/page.tsx` — branded form page (client)
- `components/inbound/lead-form.tsx` — the form component (client)

**Modify:**
- `shared/db/schema/index.ts` — export the new tables
- `trpc/root.ts` — register `inbound: createInboundRouter()`
- `app/(office)/settings/page.tsx` — render `<WebsiteFormCard />` (one-line insertion; **shared file — coordinate**)
- `app/(office)/settings/website-form-card.tsx` — the settings card (new file, keeps shared-file edit to one line)

---

## Task 1: Schema — two tables

**Files:**
- Create: `shared/db/schema/inbound-endpoints.ts`
- Modify: `shared/db/schema/index.ts`
- Test: `shared/db/schema/inbound-endpoints.test.ts`

**Interfaces:**
- Produces: Drizzle tables `inboundEndpoints`, `inboundLeadReceipts` (exported from schema barrel).

- [ ] **Step 1: Write the failing structural test**

Create `shared/db/schema/inbound-endpoints.test.ts` (model on an existing schema test, e.g. `shared/db/schema/checklists.test.ts` if present, else assert column presence):

```typescript
import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { inboundEndpoints, inboundLeadReceipts } from "./inbound-endpoints";

describe("inbound schema", () => {
  it("inbound_endpoints has org_id, channel, token, last_lead_at, soft-delete + unique keys", () => {
    const t = getTableConfig(inboundEndpoints);
    const cols = t.columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["id", "org_id", "channel", "token", "last_lead_at", "created_at", "deleted_at"]));
    expect(t.uniqueConstraints.length + t.indexes.length).toBeGreaterThan(0);
  });

  it("inbound_lead_receipts has the (org_id, channel, external_id) idempotency shape", () => {
    const cols = getTableConfig(inboundLeadReceipts).columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["id", "org_id", "channel", "external_id", "lead_id", "created_at"]));
  });
});
```

- [ ] **Step 2: Run it — expect FAIL (module not found)**

Run: `npx vitest run shared/db/schema/inbound-endpoints.test.ts 2>&1 | tail -15`

- [ ] **Step 3: Create the schema**

Create `shared/db/schema/inbound-endpoints.ts` (model column/style on `shared/db/schema/leads.ts` and the checklist tables — `orgId` references `orgs.id`, `timestamp({ withTimezone: true })`, soft-delete `deletedAt`):

```typescript
import { pgTable, uuid, text, timestamp, unique, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orgs } from "./orgs";

// A place outside a phone call that can drop leads into an org's pipeline: the website form,
// or a marketplace webhook (Angi/Thumbtack). One row per (org, channel). The token is the
// unguessable credential in the public URL (64 hex / 256-bit). "Connected" = last_lead_at set.
export const inboundEndpoints = pgTable(
  "inbound_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    token: text("token").notNull(),
    lastLeadAt: timestamp("last_lead_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("inbound_endpoints_org_channel_uq").on(t.orgId, t.channel),
    unique("inbound_endpoints_token_uq").on(t.token), // hot resolver lookup key
    check("inbound_endpoints_channel_check", sql`${t.channel} in ('form','angi','thumbtack')`),
  ],
);

// Idempotency ledger: marketplace webhooks retry. A repeated (org, channel, external_id) is a
// no-op. The form channel has no external_id and relies on phone dedupe instead.
export const inboundLeadReceipts = pgTable(
  "inbound_lead_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    externalId: text("external_id").notNull(),
    leadId: uuid("lead_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("inbound_receipts_dedupe_uq").on(t.orgId, t.channel, t.externalId),
    index("inbound_receipts_org_idx").on(t.orgId),
  ],
);
```

- [ ] **Step 4: Register in the barrel**

In `shared/db/schema/index.ts`, add (match the existing export style):
```typescript
export * from "./inbound-endpoints";
```

- [ ] **Step 5: Run test + tsc — expect PASS**

Run: `npx vitest run shared/db/schema/inbound-endpoints.test.ts 2>&1 | tail -10` → PASS
Run: `npx tsc --noEmit 2>&1 | tail -5` → 0 errors

- [ ] **Step 6: Commit**

```bash
git add shared/db/schema/inbound-endpoints.ts shared/db/schema/inbound-endpoints.test.ts shared/db/schema/index.ts
git commit -m "feat(inbound): inbound_endpoints + inbound_lead_receipts schema"
```

---

## Task 2: Migration + hand-written RLS

**Files:**
- Generate: `shared/db/migrations/0058_*.sql` + `meta/0058_snapshot.json` + `meta/_journal.json`
- Create: `shared/db/migrations/0059_inbound_rls.sql` (+ journal entry idx 59)

**Interfaces:**
- Produces: applied-later DDL for both tables + RLS. (DO NOT run `db:migrate`.)

- [ ] **Step 1: Confirm no open migration PR, then generate**

Run: `gh pr list --state open 2>&1` — confirm none touch `shared/db/migrations/`.
Run: `npm run db:generate 2>&1 | tail -8`

- [ ] **Step 2: Verify only the two tables were emitted, at 0058**

Run: `git status --short shared/db/migrations` — expect ONLY `0058_*.sql`, `meta/0058_snapshot.json`, `meta/_journal.json`.
Run: `cat shared/db/migrations/0058_*.sql` — expect `CREATE TABLE "inbound_endpoints"` + `"inbound_lead_receipts"` with the unique/check constraints, no unrelated drift.

- [ ] **Step 3: Hand-write the RLS migration**

Create `shared/db/migrations/0059_inbound_rls.sql` (model exactly on the most recent RLS migration in the folder — same `current_org_id()` helper, same statement-breakpoint format):

```sql
ALTER TABLE "inbound_endpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inbound_endpoints" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "inbound_endpoints_tenant_isolation" ON "inbound_endpoints"
  FOR ALL USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());--> statement-breakpoint
ALTER TABLE "inbound_lead_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inbound_lead_receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "inbound_lead_receipts_tenant_isolation" ON "inbound_lead_receipts"
  FOR ALL USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
```

- [ ] **Step 4: Append the journal entry**

Add an entry with `idx: 59`, `tag: "0059_inbound_rls"` to `shared/db/migrations/meta/_journal.json`, matching the exact format of the preceding entries (copy the last entry's shape; bump idx, set the tag, use the same `version`/`breakpoints` fields the neighbors use). Do NOT hand-edit any `000..0058` entries.

- [ ] **Step 5: tsc + commit (no apply)**

Run: `npx tsc --noEmit 2>&1 | tail -5` → 0 errors.
```bash
git add shared/db/migrations
git commit -m "feat(inbound): migration 0058 (tables) + 0059 RLS (not applied)"
```

Note in your report: migrations are NOT applied; the controller/Owen applies `0058`+`0059` before Task 11's integration run.

---

## Task 3: Domain — Channel, NormalizedLead, InboundEndpoint, ports

**Files:**
- Create: `modules/inbound/domain/channel.ts`, `normalized-lead.ts`, `inbound-endpoint.ts`, `inbound-ports.ts`, `lead-parser.ts`
- Test: `modules/inbound/domain/inbound-endpoint.test.ts`, `modules/inbound/domain/channel.test.ts`

**Interfaces:**
- Produces:
  - `type Channel = "form" | "angi" | "thumbtack"`; `CHANNELS: readonly Channel[]`; `isChannel(v: string): v is Channel`
  - `interface NormalizedLead { name: string; phone: string | null; email: string | null; address: string | null; notes: string | null; externalId: string | null }`
  - `InboundEndpoint` value object: `InboundEndpoint.create(props): Result<InboundEndpoint, ValidationError>`, `.props`
  - Ports: `InboundEndpointRepository`, `LeadReceiptRepository`, `InboundEndpointResolver` (see code)
  - `interface LeadParser { parse(payload: unknown): Result<NormalizedLead, ValidationError> }`

- [ ] **Step 1: Write failing domain tests**

Create `modules/inbound/domain/channel.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { isChannel, CHANNELS } from "./channel";
describe("channel", () => {
  it("guards known channels", () => {
    expect(isChannel("form")).toBe(true);
    expect(isChannel("angi")).toBe(true);
    expect(isChannel("nope")).toBe(false);
  });
  it("CHANNELS lists exactly form/angi/thumbtack", () => {
    expect([...CHANNELS].sort()).toEqual(["angi", "form", "thumbtack"]);
  });
});
```

Create `modules/inbound/domain/inbound-endpoint.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { InboundEndpoint } from "./inbound-endpoint";
import { isOk, isErr, asOrgId } from "@mallet/shared/types";

const base = {
  id: "11111111-1111-1111-1111-111111111111",
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  channel: "form" as const,
  token: "a".repeat(64),
  lastLeadAt: null,
  createdAt: new Date("2026-07-12T00:00:00Z"),
};

describe("InboundEndpoint.create", () => {
  it("accepts a valid endpoint", () => {
    expect(isOk(InboundEndpoint.create(base))).toBe(true);
  });
  it("rejects a bad channel", () => {
    expect(isErr(InboundEndpoint.create({ ...base, channel: "sms" as never }))).toBe(true);
  });
  it("rejects a token that is not 64 hex chars", () => {
    expect(isErr(InboundEndpoint.create({ ...base, token: "short" }))).toBe(true);
  });
  it("reports connected only when lastLeadAt is set", () => {
    const off = InboundEndpoint.create(base);
    const on = InboundEndpoint.create({ ...base, lastLeadAt: new Date() });
    if (isOk(off) && isOk(on)) {
      expect(off.value.isConnected).toBe(false);
      expect(on.value.isConnected).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module not found)**

Run: `npx vitest run modules/inbound/domain 2>&1 | tail -15`

- [ ] **Step 3: Implement the domain files**

`modules/inbound/domain/channel.ts`:
```typescript
export const CHANNELS = ["form", "angi", "thumbtack"] as const;
export type Channel = (typeof CHANNELS)[number];
export function isChannel(v: string): v is Channel {
  return (CHANNELS as readonly string[]).includes(v);
}
```

`modules/inbound/domain/normalized-lead.ts`:
```typescript
// The single contract every channel parser targets. Fields are already trimmed; name is required
// (a lead with no name is rejected upstream). externalId is the source's stable id for idempotency
// (null for the form channel, which has none).
export interface NormalizedLead {
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string | null;
  readonly notes: string | null;
  readonly externalId: string | null;
}
```

`modules/inbound/domain/inbound-endpoint.ts` (immutable value object, `create → Result`; model on `modules/companies/domain/company.ts`):
```typescript
import type { OrgId, Result, ValidationError } from "@mallet/shared/types";
import { ok, err, validation } from "@mallet/shared/types";
import { isChannel, type Channel } from "./channel";

const TOKEN_RE = /^[0-9a-f]{64}$/;

export interface InboundEndpointProps {
  readonly id: string;
  readonly orgId: OrgId;
  readonly channel: Channel;
  readonly token: string;
  readonly lastLeadAt: Date | null;
  readonly createdAt: Date;
}

export class InboundEndpoint {
  private constructor(private readonly p: InboundEndpointProps) {}
  get props(): InboundEndpointProps { return this.p; }
  get isConnected(): boolean { return this.p.lastLeadAt !== null; }

  static create(props: InboundEndpointProps): Result<InboundEndpoint, ValidationError> {
    if (!isChannel(props.channel)) return err(validation(`invalid channel: ${props.channel}`, "channel"));
    if (!TOKEN_RE.test(props.token)) return err(validation("token must be 64 hex chars", "token"));
    return ok(new InboundEndpoint(props));
  }
}
```

`modules/inbound/domain/inbound-ports.ts`:
```typescript
import type { OrgId } from "@mallet/shared/types";
import type { Channel } from "./channel";
import type { InboundEndpoint } from "./inbound-endpoint";

// Org-scoped repo (runs under withTenant). Minting is idempotent per (org, channel).
export interface InboundEndpointRepository {
  listByOrg(): Promise<InboundEndpoint[]>;
  findByChannel(channel: Channel): Promise<InboundEndpoint | null>;
  create(channel: Channel, token: string): Promise<InboundEndpoint>;
  rotateToken(channel: Channel, token: string): Promise<InboundEndpoint | null>;
  softDelete(channel: Channel): Promise<void>;
  touchLastLead(channel: Channel, at: Date): Promise<void>;
}

// Idempotency ledger (runs under withTenant). Returns false if (channel, externalId) already seen.
export interface LeadReceiptRepository {
  recordIfNew(channel: Channel, externalId: string, leadId: string): Promise<boolean>;
}

// Privileged, pre-tenant token→org lookup (BYPASSRLS ownerDb). Returns minimal identity only.
export interface InboundEndpointResolver {
  resolve(token: string): Promise<{ orgId: OrgId; channel: Channel } | null>;
}
```

`modules/inbound/domain/lead-parser.ts`:
```typescript
import type { Result, ValidationError } from "@mallet/shared/types";
import type { NormalizedLead } from "./normalized-lead";

// One implementation per channel. Pure: raw payload → normalized lead (or a validation error).
export interface LeadParser {
  parse(payload: unknown): Result<NormalizedLead, ValidationError>;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run modules/inbound/domain 2>&1 | tail -10` → PASS. `npx tsc --noEmit 2>&1 | tail -5` → 0.

- [ ] **Step 5: Commit**

```bash
git add modules/inbound/domain
git commit -m "feat(inbound): domain — Channel, NormalizedLead, InboundEndpoint, ports, LeadParser"
```

---

## Task 4: Form parser + registry

**Files:**
- Create: `modules/inbound/app/parsers/form-parser.ts`, `modules/inbound/app/parsers/registry.ts`
- Test: `modules/inbound/app/parsers/form-parser.test.ts`

**Interfaces:**
- Consumes: `NormalizedLead`, `LeadParser`, `Channel`.
- Produces: `FormLeadParser` (class impl of `LeadParser`); `parserFor(channel: Channel): LeadParser | null` (PR A returns a parser only for `"form"`; `angi`/`thumbtack` return null until PR B).

- [ ] **Step 1: Write failing tests**

Create `modules/inbound/app/parsers/form-parser.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { FormLeadParser } from "./form-parser";
import { isOk, isErr } from "@mallet/shared/types";

const parser = new FormLeadParser();
const unwrap = <T>(r: { ok: true; value: T } | { ok: false }) => { if (!r.ok) throw new Error("err"); return r.value; };

describe("FormLeadParser", () => {
  it("normalizes a valid form submission (externalId null — form has none)", () => {
    const r = parser.parse({ name: "  Gary Pratt ", phone: "(925) 555-0100", email: "g@x.com", address: "1 Pine", notes: "leak" });
    expect(isOk(r)).toBe(true);
    const v = unwrap(r as never);
    expect(v).toEqual({ name: "Gary Pratt", phone: "(925) 555-0100", email: "g@x.com", address: "1 Pine", notes: "leak", externalId: null });
  });
  it("rejects a submission with no name", () => {
    expect(isErr(parser.parse({ name: "   ", phone: "5", email: "", address: "", notes: "" }))).toBe(true);
  });
  it("coerces missing optional fields to null", () => {
    const v = unwrap(parser.parse({ name: "Ann" }) as never);
    expect(v).toEqual({ name: "Ann", phone: null, email: null, address: null, notes: null, externalId: null });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run modules/inbound/app/parsers/form-parser.test.ts 2>&1 | tail -12`

- [ ] **Step 3: Implement**

`modules/inbound/app/parsers/form-parser.ts` (validate at the boundary with Zod; trim; empty → null; server re-validates phone/email leniently downstream in ingest, so the parser only requires a name):
```typescript
import { z } from "zod";
import { ok, err, validation, type Result, type ValidationError } from "@mallet/shared/types";
import type { LeadParser } from "../../domain/lead-parser";
import type { NormalizedLead } from "../../domain/normalized-lead";

const schema = z.object({
  name: z.string().max(255).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().max(320).optional(),
  address: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});
const clean = (s: string | undefined): string | null => (s?.trim() ? s.trim() : null);

export class FormLeadParser implements LeadParser {
  parse(payload: unknown): Result<NormalizedLead, ValidationError> {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return err(validation("invalid form submission", "body"));
    const name = clean(parsed.data.name);
    if (!name) return err(validation("name is required", "name"));
    return ok({
      name,
      phone: clean(parsed.data.phone),
      email: clean(parsed.data.email),
      address: clean(parsed.data.address),
      notes: clean(parsed.data.notes),
      externalId: null,
    });
  }
}
```

`modules/inbound/app/parsers/registry.ts` (Open/Closed seam — PR B adds `angi`/`thumbtack` here):
```typescript
import type { Channel } from "../../domain/channel";
import type { LeadParser } from "../../domain/lead-parser";
import { FormLeadParser } from "./form-parser";

const PARSERS: Partial<Record<Channel, LeadParser>> = {
  form: new FormLeadParser(),
};

export function parserFor(channel: Channel): LeadParser | null {
  return PARSERS[channel] ?? null;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run modules/inbound/app/parsers 2>&1 | tail -10` → PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**

```bash
git add modules/inbound/app/parsers
git commit -m "feat(inbound): form parser + channel parser registry"
```

---

## Task 5: IngestExternalLeadUseCase

**Files:**
- Create: `modules/inbound/app/ingest-external-lead.ts`
- Test: `modules/inbound/app/ingest-external-lead.test.ts`

**Interfaces:**
- Consumes: `EnsureCustomerUseCase` from `@mallet/customers` (`.exec(EnsureCustomerCommand) → Result<{lead, created}, AppError>`), `LeadReceiptRepository`, `InboundEndpointRepository`, `Channel`, `NormalizedLead`, `Phone` from `@mallet/shared/types`, `Clock`.
- Produces: `IngestExternalLeadUseCase` with
  `exec(input: { channel: Channel; source: string; lead: NormalizedLead }) → Promise<Result<{ outcome: "created" | "deduped" | "duplicate_ignored" }, AppError>>`

- [ ] **Step 1: Write failing tests** (fakes for the ports + a stub EnsureCustomer)

Create `modules/inbound/app/ingest-external-lead.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { IngestExternalLeadUseCase } from "./ingest-external-lead";
import { ok, isOk } from "@mallet/shared/types";

function makeDeps(receiptSeen = false) {
  const calls = { ensure: [] as unknown[], touched: [] as unknown[] };
  const ensure = { exec: async (cmd: unknown) => { calls.ensure.push(cmd); return ok({ lead: { props: { id: "lead-1" } }, created: true }); } };
  const receipts = { recordIfNew: async () => !receiptSeen }; // false => already seen
  const endpoints = { touchLastLead: async (...a: unknown[]) => { calls.touched.push(a); } };
  const clock = { now: () => new Date("2026-07-12T00:00:00Z") };
  return { uc: new IngestExternalLeadUseCase(ensure as never, receipts as never, endpoints as never, clock as never), calls };
}
const lead = { name: "Gary", phone: "(925) 555-0100", email: null, address: null, notes: null, externalId: "angi-1" };

describe("IngestExternalLeadUseCase", () => {
  it("creates a customer and stamps last_lead_at", async () => {
    const { uc, calls } = makeDeps();
    const r = await uc.exec({ channel: "angi", source: "Angi", lead });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.outcome).toBe("created");
    expect(calls.ensure).toHaveLength(1);
    expect(calls.touched).toHaveLength(1);
  });
  it("ignores a duplicate (external_id already received) without calling ensureCustomer", async () => {
    const { uc, calls } = makeDeps(true);
    const r = await uc.exec({ channel: "angi", source: "Angi", lead });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.outcome).toBe("duplicate_ignored");
    expect(calls.ensure).toHaveLength(0);
  });
  it("skips the receipt guard when externalId is null (form channel)", async () => {
    const { uc, calls } = makeDeps(true); // even if recordIfNew would say seen, null id skips it
    const r = await uc.exec({ channel: "form", source: "Website", lead: { ...lead, externalId: null } });
    if (isOk(r)) expect(r.value.outcome).toBe("created");
    expect(calls.ensure).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run modules/inbound/app/ingest-external-lead.test.ts 2>&1 | tail -12`

- [ ] **Step 3: Implement**

`modules/inbound/app/ingest-external-lead.ts` (order: idempotency guard → phone parse (lenient) → EnsureCustomer → record receipt + touch. Never throws for validation; a bad phone/email is dropped, matching the CSV importer's server rule):
```typescript
import { Phone, isOk, ok, type Result, type AppError, type Clock } from "@mallet/shared/types";
import type { EnsureCustomerUseCase } from "@mallet/customers";
import type { LeadReceiptRepository, InboundEndpointRepository } from "../domain/inbound-ports";
import type { Channel } from "../domain/channel";
import type { NormalizedLead } from "../domain/normalized-lead";
import { logger } from "@mallet/shared/observability";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface IngestInput {
  readonly channel: Channel;
  readonly source: string;
  readonly lead: NormalizedLead;
}
export type IngestOutcome = "created" | "deduped" | "duplicate_ignored";

export class IngestExternalLeadUseCase {
  constructor(
    private readonly ensureCustomer: EnsureCustomerUseCase,
    private readonly receipts: LeadReceiptRepository,
    private readonly endpoints: InboundEndpointRepository,
    private readonly clock: Clock,
  ) {}

  async exec(input: IngestInput): Promise<Result<{ outcome: IngestOutcome }, AppError>> {
    const { channel, source, lead } = input;
    // Lenient phone/email — drop if unreadable, never reject the whole ingest.
    const parsedPhone = lead.phone ? Phone.parse(lead.phone) : null;
    const phone = parsedPhone && isOk(parsedPhone) ? parsedPhone.value : null;
    const email = lead.email && EMAIL_RE.test(lead.email) ? lead.email : null;

    const result = await this.ensureCustomer.exec({
      name: lead.name, phone, email, source,
      companyId: null, role: null, notes: lead.notes, address: lead.address,
    });
    if (!isOk(result)) return result;

    // Idempotency: record AFTER a successful create so a mid-flight failure can be retried.
    // A repeat (channel, externalId) that was already recorded → treat as duplicate.
    if (lead.externalId) {
      const fresh = await this.receipts.recordIfNew(channel, lead.externalId, result.value.lead.props.id);
      if (!fresh) {
        logger.info({ channel }, "inbound.duplicate_ignored");
        return ok({ outcome: "duplicate_ignored" });
      }
    }
    await this.endpoints.touchLastLead(channel, this.clock.now());
    const outcome = result.value.created ? "created" : "deduped";
    logger.info({ channel, outcome }, `inbound.${outcome}`);
    return ok({ outcome });
  }
}
```

> NOTE (idempotency ordering): the guard runs after EnsureCustomer, so a genuine retry that arrives *after* the first fully succeeded is caught by the receipt; because EnsureCustomer dedupes by phone, the retry does not create a second phoned customer even in the pre-receipt window. Phoneless retries within that window are the documented v1 edge (spec §Error handling). Keep this ordering.

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run modules/inbound/app/ingest-external-lead.test.ts 2>&1 | tail -10` → PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**

```bash
git add modules/inbound/app/ingest-external-lead.ts modules/inbound/app/ingest-external-lead.test.ts
git commit -m "feat(inbound): IngestExternalLeadUseCase (reuse EnsureCustomer + idempotency)"
```

---

## Task 6: Infra — resolver, repository, receipts, mapper

**Files:**
- Create: `modules/inbound/infra/inbound-mapper.ts`, `drizzle-inbound-endpoint-resolver.ts`, `drizzle-inbound-endpoint-repository.ts`, `drizzle-lead-receipt-repository.ts`

**Interfaces:**
- Consumes: `inboundEndpoints`, `inboundLeadReceipts` tables; `ownerDb`; `withTenant`'s `TenantTx`; ports from Task 3.
- Produces: `DrizzleInboundEndpointResolver` (impl `InboundEndpointResolver`, uses `ownerDb`), `DrizzleInboundEndpointRepository(tx, orgId)` (impl `InboundEndpointRepository`), `DrizzleLeadReceiptRepository(tx, orgId)` (impl `LeadReceiptRepository`), `rowToInboundEndpoint`.

- [ ] **Step 1: Implement the mapper**

`modules/inbound/infra/inbound-mapper.ts` (fail-fast on corrupt row via `InboundEndpoint.create` + `orThrow`-style):
```typescript
import { asOrgId, unwrapOrThrow } from "@mallet/shared/types";
import { InboundEndpoint } from "../domain/inbound-endpoint";
import { isChannel } from "../domain/channel";

export interface InboundEndpointRow {
  id: string; orgId: string; channel: string; token: string;
  lastLeadAt: Date | null; createdAt: Date;
}

export function rowToInboundEndpoint(row: InboundEndpointRow): InboundEndpoint {
  if (!isChannel(row.channel)) throw new Error(`corrupt inbound_endpoints.channel: ${row.channel}`);
  return unwrapOrThrow(InboundEndpoint.create({
    id: row.id, orgId: asOrgId(row.orgId), channel: row.channel,
    token: row.token, lastLeadAt: row.lastLeadAt, createdAt: row.createdAt,
  }));
}
```
> If `unwrapOrThrow` does not exist in `@mallet/shared/types`, use the codebase's existing fail-fast unwrap (grep for how other mappers unwrap a `Result`, e.g. `modules/customers/infra/lead-mapper.ts`) and match it.

- [ ] **Step 2: Implement the privileged resolver** (template: `modules/quoting/infra/drizzle-public-estimate-reader.ts`)

`modules/inbound/infra/drizzle-inbound-endpoint-resolver.ts`:
```typescript
import { and, eq, isNull } from "drizzle-orm";
import { ownerDb } from "@mallet/shared/db/owner-client";
import { inboundEndpoints } from "@mallet/shared/db/schema";
import { asOrgId, type OrgId } from "@mallet/shared/types";
import { isChannel, type Channel } from "../domain/channel";
import type { InboundEndpointResolver } from "../domain/inbound-ports";

// Pre-tenant token→org lookup on ownerDb (BYPASSRLS) — no session, unguessable token is the sole
// credential. Returns ONLY { orgId, channel }; never accepts an org id from the caller. All writes
// after this re-enter withTenant. Mirrors DrizzlePublicEstimateReader.
export class DrizzleInboundEndpointResolver implements InboundEndpointResolver {
  async resolve(token: string): Promise<{ orgId: OrgId; channel: Channel } | null> {
    const rows = await ownerDb
      .select({ orgId: inboundEndpoints.orgId, channel: inboundEndpoints.channel })
      .from(inboundEndpoints)
      .where(and(eq(inboundEndpoints.token, token), isNull(inboundEndpoints.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row || !isChannel(row.channel)) return null;
    return { orgId: asOrgId(row.orgId), channel: row.channel };
  }
}
```

- [ ] **Step 3: Implement the org-scoped repository + receipts** (template: `modules/customers/infra/drizzle-lead-repository.ts` for the `(tx, orgId)` constructor + explicit `eq(orgId)`)

`modules/inbound/infra/drizzle-inbound-endpoint-repository.ts`:
```typescript
import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "@mallet/shared/db/tx";
import { inboundEndpoints } from "@mallet/shared/db/schema";
import type { OrgId } from "@mallet/shared/types";
import type { InboundEndpointRepository } from "../domain/inbound-ports";
import type { Channel } from "../domain/channel";
import { InboundEndpoint } from "../domain/inbound-endpoint";
import { rowToInboundEndpoint } from "./inbound-mapper";

export class DrizzleInboundEndpointRepository implements InboundEndpointRepository {
  constructor(private readonly tx: TenantTx, private readonly orgId: OrgId) {}

  async listByOrg(): Promise<InboundEndpoint[]> {
    const rows = await this.tx.select().from(inboundEndpoints)
      .where(and(eq(inboundEndpoints.orgId, this.orgId), isNull(inboundEndpoints.deletedAt)));
    return rows.map(rowToInboundEndpoint);
  }
  async findByChannel(channel: Channel): Promise<InboundEndpoint | null> {
    const rows = await this.tx.select().from(inboundEndpoints)
      .where(and(eq(inboundEndpoints.orgId, this.orgId), eq(inboundEndpoints.channel, channel), isNull(inboundEndpoints.deletedAt))).limit(1);
    return rows[0] ? rowToInboundEndpoint(rows[0]) : null;
  }
  async create(channel: Channel, token: string): Promise<InboundEndpoint> {
    const [row] = await this.tx.insert(inboundEndpoints)
      .values({ orgId: this.orgId, channel, token })
      .onConflictDoUpdate({ target: [inboundEndpoints.orgId, inboundEndpoints.channel], set: { deletedAt: null } })
      .returning();
    return rowToInboundEndpoint(row!);
  }
  async rotateToken(channel: Channel, token: string): Promise<InboundEndpoint | null> {
    const [row] = await this.tx.update(inboundEndpoints).set({ token })
      .where(and(eq(inboundEndpoints.orgId, this.orgId), eq(inboundEndpoints.channel, channel), isNull(inboundEndpoints.deletedAt))).returning();
    return row ? rowToInboundEndpoint(row) : null;
  }
  async softDelete(channel: Channel): Promise<void> {
    await this.tx.update(inboundEndpoints).set({ deletedAt: new Date() })
      .where(and(eq(inboundEndpoints.orgId, this.orgId), eq(inboundEndpoints.channel, channel)));
  }
  async touchLastLead(channel: Channel, at: Date): Promise<void> {
    await this.tx.update(inboundEndpoints).set({ lastLeadAt: at })
      .where(and(eq(inboundEndpoints.orgId, this.orgId), eq(inboundEndpoints.channel, channel)));
  }
}
```

`modules/inbound/infra/drizzle-lead-receipt-repository.ts`:
```typescript
import { inboundLeadReceipts } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import type { LeadReceiptRepository } from "../domain/inbound-ports";
import type { Channel } from "../domain/channel";

export class DrizzleLeadReceiptRepository implements LeadReceiptRepository {
  constructor(private readonly tx: TenantTx, private readonly orgId: OrgId) {}
  // INSERT .. ON CONFLICT DO NOTHING; a returned row means it was new.
  async recordIfNew(channel: Channel, externalId: string, leadId: string): Promise<boolean> {
    const rows = await this.tx.insert(inboundLeadReceipts)
      .values({ orgId: this.orgId, channel, externalId, leadId })
      .onConflictDoNothing({ target: [inboundLeadReceipts.orgId, inboundLeadReceipts.channel, inboundLeadReceipts.externalId] })
      .returning({ id: inboundLeadReceipts.id });
    return rows.length > 0;
  }
}
```

- [ ] **Step 4: tsc — expect 0 errors**

Run: `npx tsc --noEmit 2>&1 | tail -8`. (No unit test here — covered by the Task 11 integration test against the live DB, which is the right layer for repository SQL.)

- [ ] **Step 5: Commit**

```bash
git add modules/inbound/infra
git commit -m "feat(inbound): infra — privileged resolver, org-scoped endpoint repo, receipts, mapper"
```

---

## Task 7: `v1.inbound` router + DTOs + barrel + registration

**Files:**
- Create: `modules/inbound/api/inbound-dto.ts`, `modules/inbound/api/inbound-router.ts`, `modules/inbound/index.ts`
- Modify: `trpc/root.ts`
- Test: `modules/inbound/api/inbound-router.int.test.ts` (written now; RUN in Task 11 after migration)

**Interfaces:**
- Consumes: `ownerOrOffice`, `router` from `@/trpc/init`; the repo from Task 6; `withTenant` via `ctx`; token gen.
- Produces: `createInboundRouter()` registered as `v1.inbound`, with `list`, `generate({channel})`, `rotate({channel})`, `disable({channel})`. DTO `inboundEndpointDTO { channel, token, connected, lastLeadAt: string | null }`.

- [ ] **Step 1: Write the integration test (run deferred to Task 11)**

Create `modules/inbound/api/inbound-router.int.test.ts` — copy the org/principal bootstrap verbatim from a sibling int test (`modules/companies/api/company-router.int.test.ts`). Cases:
```typescript
// generate creates an endpoint with a 64-hex token; list returns it; generate again is idempotent
// (same token); rotate changes the token; disable soft-deletes (list no longer returns it);
// tech role → FORBIDDEN; cross-tenant caller cannot see another org's endpoint.
```
Assert: `generate({channel:"form"})` returns `token` matching `/^[0-9a-f]{64}$/`, `connected===false`; second `generate` returns the SAME token; `rotate` returns a different token; after `disable`, `list` is empty; a tech-role caller on `generate` throws FORBIDDEN.

- [ ] **Step 2: Implement DTOs**

`modules/inbound/api/inbound-dto.ts`:
```typescript
import { z } from "zod";
export const inboundEndpointDTO = z.object({
  channel: z.enum(["form", "angi", "thumbtack"]),
  token: z.string(),
  connected: z.boolean(),
  lastLeadAt: z.string().nullable(),
});
export const channelInput = z.object({ channel: z.enum(["form", "angi", "thumbtack"]) });
```

- [ ] **Step 3: Implement the router** (model on `modules/companies/api/company-router.ts`; org from `ctx.principal.orgId`; token via `randomBytes`)

`modules/inbound/api/inbound-router.ts`:
```typescript
import { randomBytes } from "node:crypto";
import { router, ownerOrOffice } from "@/trpc/init";
import { z } from "zod";
import { DrizzleInboundEndpointRepository } from "../infra/drizzle-inbound-endpoint-repository";
import { inboundEndpointDTO, channelInput } from "./inbound-dto";
import type { InboundEndpoint } from "../domain/inbound-endpoint";

const generateToken = (): string => randomBytes(32).toString("hex");
const toDTO = (e: InboundEndpoint) => ({
  channel: e.props.channel, token: e.props.token, connected: e.isConnected,
  lastLeadAt: e.props.lastLeadAt?.toISOString() ?? null,
});

export const createInboundRouter = () =>
  router({
    list: ownerOrOffice.output(z.array(inboundEndpointDTO)).query(async ({ ctx }) => {
      const repo = new DrizzleInboundEndpointRepository(ctx.tx, ctx.principal.orgId);
      return (await repo.listByOrg()).map(toDTO);
    }),
    generate: ownerOrOffice.input(channelInput).output(inboundEndpointDTO).mutation(async ({ ctx, input }) => {
      const repo = new DrizzleInboundEndpointRepository(ctx.tx, ctx.principal.orgId);
      const existing = await repo.findByChannel(input.channel);   // idempotent: return existing token
      const endpoint = existing ?? (await repo.create(input.channel, generateToken()));
      return toDTO(endpoint);
    }),
    rotate: ownerOrOffice.input(channelInput).output(inboundEndpointDTO.nullable()).mutation(async ({ ctx, input }) => {
      const repo = new DrizzleInboundEndpointRepository(ctx.tx, ctx.principal.orgId);
      const rotated = await repo.rotateToken(input.channel, generateToken());
      return rotated ? toDTO(rotated) : null;
    }),
    disable: ownerOrOffice.input(channelInput).output(z.object({ ok: z.literal(true) })).mutation(async ({ ctx, input }) => {
      const repo = new DrizzleInboundEndpointRepository(ctx.tx, ctx.principal.orgId);
      await repo.softDelete(input.channel);
      return { ok: true as const };
    }),
  });
```

- [ ] **Step 4: Barrel + register**

`modules/inbound/index.ts`:
```typescript
export { createInboundRouter } from "./api/inbound-router";
export { DrizzleInboundEndpointResolver } from "./infra/drizzle-inbound-endpoint-resolver";
export { DrizzleInboundEndpointRepository } from "./infra/drizzle-inbound-endpoint-repository";
export { DrizzleLeadReceiptRepository } from "./infra/drizzle-lead-receipt-repository";
export { IngestExternalLeadUseCase } from "./app/ingest-external-lead";
export { parserFor } from "./app/parsers/registry";
export { isChannel, CHANNELS, type Channel } from "./domain/channel";
```
In `trpc/root.ts`: add `import { createInboundRouter } from "@mallet/inbound";` and register `inbound: createInboundRouter(),` in the `v1` object (match the existing registration style — check whether the alias is `@mallet/inbound` or a relative path by copying how `customers`/`companies` are imported there; add the package path to `tsconfig`/`package.json` workspaces only if the codebase requires it for other modules — otherwise use the same import form the neighbors use).

- [ ] **Step 5: tsc — expect 0 errors**

Run: `npx tsc --noEmit 2>&1 | tail -8`. (Int test RUN is deferred to Task 11.)

- [ ] **Step 6: Commit**

```bash
git add modules/inbound/api modules/inbound/index.ts trpc/root.ts modules/inbound/api/inbound-router.int.test.ts
git commit -m "feat(inbound): v1.inbound router (generate/list/rotate/disable) + barrel + registration"
```

---

## Task 8: Public intake route `POST /api/inbound/[channel]/[token]`

**Files:**
- Create: `app/api/inbound/[channel]/[token]/route.ts`

**Interfaces:**
- Consumes: `DrizzleInboundEndpointResolver`, `parserFor`, `IngestExternalLeadUseCase`, `EnsureCustomerUseCase`, `DrizzleLeadRepository`, `DrizzleLeadReceiptRepository`, `DrizzleInboundEndpointRepository`, `withTenant`, `getAppDeps`, `runWithContext`/`enrichRequestContext`.
- Produces: POST handler that ingests a lead; GET handler that returns `{ brand }` for `channel === "form"` (for the form page). Template: `app/api/webhooks/twilio/route.ts`.

- [ ] **Step 1: Implement the route** (verify-nothing-from-client; resolve org privileged; withTenant; no PII logs; source map by channel)

`app/api/inbound/[channel]/[token]/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { withTenant } from "@mallet/shared/db/tx";
import { runWithContext, enrichRequestContext, logger } from "@mallet/shared/observability";
import { getAppDeps } from "@/trpc/di";
import { DrizzleInboundEndpointResolver, DrizzleInboundEndpointRepository, DrizzleLeadReceiptRepository, IngestExternalLeadUseCase, parserFor, isChannel } from "@mallet/inbound";
import { EnsureCustomerUseCase, DrizzleLeadRepository } from "@mallet/customers";
import { ownerDb } from "@mallet/shared/db/owner-client";
import { inboundEndpoints, orgs } from "@mallet/shared/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_RE = /^[0-9a-f]{64}$/;
const SOURCE: Record<string, string> = { form: "Website", angi: "Angi", thumbtack: "Thumbtack" };

export async function POST(req: Request, { params }: { params: Promise<{ channel: string; token: string }> }) {
  const { channel, token } = await params;
  if (!isChannel(channel) || !TOKEN_RE.test(token)) return new NextResponse("not found", { status: 404 });

  const parser = parserFor(channel);
  if (!parser) return new NextResponse("channel not enabled", { status: 404 }); // angi/thumbtack until PR B

  let payload: unknown;
  try { payload = await req.json(); } catch { return new NextResponse("invalid body", { status: 400 }); }

  const parsed = parser.parse(payload);
  if (!parsed.ok) return new NextResponse("invalid submission", { status: 400 });

  const deps = getAppDeps();
  return runWithContext({ requestId: deps.ids.newId() }, async () => {
    const resolved = await new DrizzleInboundEndpointResolver().resolve(token);
    if (!resolved || resolved.channel !== channel) {
      logger.warn({ channel }, "inbound.rejected_unknown_token");
      return new NextResponse("not found", { status: 404 });
    }
    enrichRequestContext({ orgId: resolved.orgId });
    const outcome = await withTenant(resolved.orgId, async (tx) => {
      const bus = deps.makeBus ? deps.makeBus(tx, resolved.orgId) : deps.bus; // match how Twilio builds the tx-bound bus
      const ensure = new EnsureCustomerUseCase(new DrizzleLeadRepository(tx, resolved.orgId), bus, deps.clock);
      const uc = new IngestExternalLeadUseCase(ensure, new DrizzleLeadReceiptRepository(tx, resolved.orgId), new DrizzleInboundEndpointRepository(tx, resolved.orgId), deps.clock);
      return uc.exec({ channel, source: SOURCE[channel]!, lead: parsed.value });
    });
    if (!outcome.ok) { logger.error({ channel }, "inbound.ingest_failed"); return new NextResponse("could not accept lead", { status: 422 }); }
    return NextResponse.json({ ok: true });
  });
}

// GET: brand for the public form page (form channel only). Privileged, minimal (name + color).
export async function GET(_req: Request, { params }: { params: Promise<{ channel: string; token: string }> }) {
  const { channel, token } = await params;
  if (channel !== "form" || !TOKEN_RE.test(token)) return new NextResponse("not found", { status: 404 });
  const rows = await ownerDb.select({ orgName: orgs.name }).from(inboundEndpoints)
    .innerJoin(orgs, eq(orgs.id, inboundEndpoints.orgId))
    .where(and(eq(inboundEndpoints.token, token), eq(inboundEndpoints.channel, "form"), isNull(inboundEndpoints.deletedAt))).limit(1);
  if (!rows[0]) return new NextResponse("not found", { status: 404 });
  return NextResponse.json({ brand: { name: rows[0].orgName } });
}
```

> IMPORTANT: before finalizing, open `app/api/webhooks/twilio/route.ts` and `trpc/di.ts` to confirm the EXACT deps shape — how the tx-bound `EventBus` is constructed (the Twilio route builds `OutboxEventBus`/similar inside `withTenant`; use the identical construction here rather than the `deps.makeBus ?? deps.bus` placeholder above). Match it exactly; do not invent a bus. Also confirm `deps.ids.newId()` and `deps.clock` names against `getAppDeps()`.

- [ ] **Step 2: tsc — expect 0 errors**

Run: `npx tsc --noEmit 2>&1 | tail -8`. Fix the bus construction to match Twilio's.

- [ ] **Step 3: Commit**

```bash
git add "app/api/inbound/[channel]/[token]/route.ts"
git commit -m "feat(inbound): public intake route (form POST + brand GET) — resolve→withTenant→ingest"
```

---

## Task 9: Public branded form page + form component

**Files:**
- Create: `app/(public)/f/[token]/page.tsx`, `components/inbound/lead-form.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/inbound/form/[token]`.
- Produces: a public page that fetches brand then renders `<LeadForm token brandName />` which POSTs the submission and shows a thank-you state.

- [ ] **Step 1: Implement the form component** (client; honeypot + min-time; in-flow states; functional copy)

`components/inbound/lead-form.tsx`:
```typescript
"use client";
import { useState, useRef } from "react";

const MIN_SUBMIT_MS = 1500; // faster than this = almost certainly a bot

export function LeadForm({ token, brandName }: { token: string; brandName: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mountedAt = useRef(Date.now());

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (String(form.get("company_website"))) return;            // honeypot filled → silently drop
    if (Date.now() - mountedAt.current < MIN_SUBMIT_MS) return; // too fast → drop
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/inbound/form/${token}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"), phone: form.get("phone"), email: form.get("email"),
          address: form.get("address"), notes: form.get("notes"),
        }),
      });
      if (!res.ok) { setError("Something went wrong — please call us instead."); setBusy(false); return; }
      setDone(true);
    } catch { setError("Something went wrong — please call us instead."); setBusy(false); }
  }

  if (done) return <div className="lead-form-done"><h2>Thanks — we got it.</h2><p>{brandName} will reach out shortly.</p></div>;

  return (
    <form onSubmit={onSubmit} className="lead-form">
      <h1>Request service from {brandName}</h1>
      <label>Name<input name="name" required maxLength={255} autoComplete="name" /></label>
      <label>Phone<input name="phone" inputMode="tel" maxLength={40} autoComplete="tel" /></label>
      <label>Email<input name="email" type="email" maxLength={320} autoComplete="email" /></label>
      <label>Service address<input name="address" maxLength={500} autoComplete="street-address" /></label>
      <label>What do you need?<textarea name="notes" maxLength={2000} rows={4} /></label>
      {/* honeypot: hidden from humans, tempting to bots */}
      <input name="company_website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px" }} />
      {error && <p className="lead-form-error">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? "Sending…" : "Request service"}</button>
    </form>
  );
}
```
> Style with the app's existing form vocabulary (reuse `.auth-*`/`.field` classes or inline styles consistent with the CSV import modal); keep it clean and mobile-friendly (this renders inside an iframe on the shop's site). No floating UI.

- [ ] **Step 2: Implement the page** (resolve brand; 404 UI on bad token)

`app/(public)/f/[token]/page.tsx`:
```typescript
"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { LeadForm } from "@/components/inbound/lead-form";

export default function PublicLeadFormPage() {
  const { token } = useParams<{ token: string }>();
  const [brandName, setBrandName] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/inbound/form/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setBrandName(d.brand.name))
      .catch(() => setNotFound(true));
  }, [token]);

  if (notFound) return <main className="lead-form-wrap"><p>This form link isn’t active.</p></main>;
  if (brandName === null) return <main className="lead-form-wrap"><p>Loading…</p></main>;
  return <main className="lead-form-wrap"><LeadForm token={token} brandName={brandName} /></main>;
}
```
> Confirm `app/(public)/layout.tsx` does not impose an authed shell (the quote page lives here unauthenticated — verify). Add minimal `.lead-form*` styles to the public CSS if needed, matching the quote page's aesthetic.

- [ ] **Step 3: tsc + build — expect 0 errors, route compiles**

Run: `npx tsc --noEmit 2>&1 | tail -6` → 0. `npm run build 2>&1 | tail -6` → `/f/[token]` in the route list.

- [ ] **Step 4: Commit**

```bash
git add "app/(public)/f/[token]/page.tsx" components/inbound/lead-form.tsx
git commit -m "feat(inbound): public branded lead form page (shareable + iframe) with honeypot"
```

---

## Task 10: Settings "Website form" card

**Files:**
- Create: `app/(office)/settings/website-form-card.tsx`
- Modify: `app/(office)/settings/page.tsx` (one-line render in the "Ways leads reach you" area — **shared file, keep the edit minimal**)

**Interfaces:**
- Consumes: `api.v1.inbound.list` (query), `api.v1.inbound.generate` (mutation), `FoldCard`, `PUBLIC_APP_URL` (via `NEXT_PUBLIC_APP_URL` or the client config the app already uses for building links — check how the app builds public URLs client-side).
- Produces: `<WebsiteFormCard />` — shows the shareable link + iframe snippet once generated; a "Get your form" button when not.

- [ ] **Step 1: Implement the card** (in-flow reveal, no floating UI; functional copy)

`app/(office)/settings/website-form-card.tsx`:
```typescript
"use client";
import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { FoldCard } from "./fold-card";

// Base URL for the public form link. Reuse the app's existing public-URL source (check how other
// client code builds absolute links — e.g. the quote-link copy in the estimate send screen — and
// match it; fall back to window.location.origin).
function publicBase(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? (typeof window !== "undefined" ? window.location.origin : "");
}

export function WebsiteFormCard() {
  const utils = api.useUtils();
  const list = api.v1.inbound.list.useQuery();
  const generate = api.v1.inbound.generate.useMutation({ onSuccess: () => utils.v1.inbound.list.invalidate() });
  const [copied, setCopied] = useState("");

  const form = list.data?.find((e) => e.channel === "form");
  const link = form ? `${publicBase()}/f/${form.token}` : "";
  const iframe = `<iframe src="${link}" style="width:100%;max-width:520px;height:640px;border:0" title="Request service"></iframe>`;
  const copy = (label: string, text: string) => { void navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(""), 1500); };

  return (
    <FoldCard title="Website form" summary={form ? "Live" : "Not set up"}>
      {!form ? (
        <>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>A “request service” form for your website — share the link or embed it. Every submission lands in your pipeline.</p>
          <button className="btn primary" disabled={generate.isPending} onClick={() => generate.mutate({ channel: "form" })}>
            {generate.isPending ? "Creating…" : "Get your form"}
          </button>
        </>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Share this link</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input readOnly value={link} style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
              <button className="btn" onClick={() => copy("link", link)}>{copied === "link" ? "Copied" : "Copy"}</button>
              <a className="btn ghost" href={link} target="_blank" rel="noopener noreferrer">Preview</a>
            </div>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Or embed on your site</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input readOnly value={iframe} style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "var(--font-mono, monospace)", fontSize: 12 }} />
              <button className="btn" onClick={() => copy("iframe", iframe)}>{copied === "iframe" ? "Copied" : "Copy"}</button>
            </div>
          </div>
        </div>
      )}
    </FoldCard>
  );
}
```

- [ ] **Step 2: Render it in the settings page**

In `app/(office)/settings/page.tsx`, import `WebsiteFormCard` and render `<WebsiteFormCard />` in the "Ways leads reach you" area (in `SecSources`, directly after the "Import customers" card). ONE import line + ONE render line — do not touch the Source-list or marketplace blocks (coordinate with the concurrent Source-list work).

- [ ] **Step 3: tsc + lint — expect 0**

Run: `npx tsc --noEmit 2>&1 | tail -6`; `npx eslint app/(office)/settings/website-form-card.tsx "app/(office)/settings/page.tsx" 2>&1 | grep -E "error|problems"`.

- [ ] **Step 4: Commit**

```bash
git add app/(office)/settings/website-form-card.tsx "app/(office)/settings/page.tsx"
git commit -m "feat(inbound): Website form settings card (shareable link + iframe)"
```

---

## Task 11: Migration apply + integration tests + full gate + screenshots + PR

**Files:** verification only (+ any fixes surfaced).

- [ ] **Step 1: Apply migrations (controller-authorized) or request Owen**

Run: `npm run db:migrate 2>&1 | tail -10` — applies `0058` + `0059` to the live shared DB (additive). If it fails on the storage schema or perms, STOP and report.

- [ ] **Step 2: Run the inbound integration tests**

Run: `npm run test:int -- inbound 2>&1 | tail -20` — the Task 7 `v1.inbound` cases pass (generate 64-hex token, idempotent, rotate, disable, tech→FORBIDDEN, cross-tenant isolation).

- [ ] **Step 3: Add + run a route-level integration test**

Create `app/api/inbound/inbound-route.int.test.ts` (or colocated) that, against the live DB: mints a form endpoint for a test org (via the repo under `withTenant`), POSTs a valid body to the resolver→ingest path, and asserts a lead was created in that org and NOT in another; a bad token → 404; a form submission with no name → 400. If driving the actual Next route handler is impractical in the int harness, test `DrizzleInboundEndpointResolver.resolve` + `IngestExternalLeadUseCase` wired to real repos under `withTenant` (same coverage, one layer down). Run: `npm run test:int -- inbound 2>&1 | tail -20`.

- [ ] **Step 4: Full gate**

```bash
npx tsc --noEmit 2>&1 | tail -5           # 0
npm run lint 2>&1 | tail -5               # 0 errors
npm test 2>&1 | tail -6                    # all unit pass
npm run coverage 2>&1 | tail -8            # >= 80% stmts / 75% branches
npm run build 2>&1 | tail -5               # ok; /f/[token] + /api/inbound/[channel]/[token] present
```

- [ ] **Step 5: Screenshot-verify** (dedicated port; see the mallet-worktree-dev-screenshot memory)

Boot `PORT=3210 pnpm dev`; (a) as E2E owner, Settings → Lead sources → Website form → "Get your form" → screenshot the revealed link+iframe; (b) open the form link directly → screenshot the branded public form; submit it → confirm the thank-you state and that a lead appears. Delete the throwaway spec + `git checkout -- next-env.d.ts`.

- [ ] **Step 6: Open the PR**

```bash
git push -u origin feat/inbound-leads
gh pr create --base main --title "feat(inbound): lead intake spine + website form" --body "<summary, verification table, the SecSources coordination note, and: migration 0058+0059 applied; PR B (Angi/Thumbtack parsers) stacks on this>"
```

---

## Self-Review

### Spec coverage
| Spec item | Task |
|---|---|
| One primitive, three channels; parser seam | 3 (LeadParser), 4 (registry), 8 (route) |
| `inbound_endpoints` + `inbound_lead_receipts` + indexes | 1 |
| Hand-written RLS | 2 |
| Privileged token→org resolver (ownerDb) | 6 |
| Reuse EnsureCustomerUseCase + dedupe | 5 |
| Idempotency (receipts) | 1, 5, 6 |
| Public intake route (validate at boundary, no PII logs, withTenant) | 8 |
| Website form: hosted link + iframe, shop-branded, honeypot+min-time | 8 (GET brand), 9 |
| `v1.inbound` (list/generate/rotate/disable), ownerOrOffice, DTO≠domain | 7 |
| Settings "Website form" card | 10 |
| Yelp/Google/email-parse excluded (YAGNI) | (not built — correct) |
| Marketplace parsers/card | PR B (out of scope here) |
| Tests: unit many / int some / e2e few | 3,4,5 unit; 7,11 int; 11 screenshot |

### Placeholder scan
The two explicit "confirm against the real code" notes (Task 6 unwrap helper; Task 8 bus construction) are deliberate — they name exactly what to verify and the sibling file to copy, not vague TODOs. The Task 7 `@mallet/inbound` import-alias note tells the implementer to copy the neighbors' import form. No logic step lacks code.

### Type consistency
`Channel`, `NormalizedLead`, `InboundEndpoint(.props/.isConnected)`, the three ports, `IngestExternalLeadUseCase.exec({channel,source,lead}) → {outcome}`, `parserFor`, `DrizzleInboundEndpointResolver.resolve → {orgId,channel}`, and the `inboundEndpointDTO` shape are used identically across tasks 3→11. Token format `/^[0-9a-f]{64}$/` and `randomBytes(32).toString("hex")` match everywhere.

### v1 limitations (documented, intentional)
- Form-channel retries rely on phone dedupe (no external id) — spec §Error handling.
- Rate limiting is honeypot + min-submit-time in PR A; a per-token fixed-window limiter is deferred (flag in PR body) unless the gate/review demands it now.
