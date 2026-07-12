# Inbound Lead Intake — PR B (Angi + Thumbtack) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the Angi and Thumbtack marketplace channels on the PR A spine, and harden idempotency so a retried webhook can never double-create a lead.

**Architecture:** PR A already routes `POST /api/inbound/{channel}/{token}` → resolver → `parserFor(channel)` → `withTenant` → `IngestExternalLeadUseCase` → `EnsureCustomerUseCase`. PR B (a) refactors idempotency to **record-first (receipt-as-lock)** because marketplaces retry and their leads can be phoneless (dedupe-by-phone can't catch those); (b) adds `AngiLeadParser` + `ThumbtackLeadParser` and registers them; (c) wires the "Lead marketplaces" settings card to mint + reveal a per-shop webhook URL. The route needs NO change — `parserFor` returning a non-null parser is all it takes.

**Tech Stack:** Next.js 16, tRPC v11, Drizzle + Supabase (RLS), Zod, Vitest. No new dependency.

## Global Constraints

- Working dir: `/Users/owensmacbook/Downloads/prospecting/mallet-app-inbound-marketplaces` (branch `feat/inbound-marketplaces`, off `origin/main` @ `cd429fd` — PR A merged).
- Spec: `docs/superpowers/specs/2026-07-12-inbound-lead-intake-design.md`. PR A plan: `docs/superpowers/plans/2026-07-12-inbound-leads-pr-a.md`.
- **NO schema change / NO migration** — reuses PR A's `inbound_endpoints` + `inbound_lead_receipts`. (⚠️ the shared drizzle ledger has drifted from parallel work — do NOT `db:generate`/`db:migrate` in this PR; there's nothing to migrate.)
- Tenant safety unchanged: org id ONLY from the token resolver; all writes in `withTenant`; token-in-URL (256-bit) is the credential.
- **Idempotency (the core correctness goal):** record-first. `IngestExternalLeadUseCase` must, for a lead with an `externalId`, reserve `(org, channel, externalId)` in the receipts ledger BEFORE creating the customer; a duplicate reservation → return `duplicate_ignored` and do NOT create; if the create then fails, RELEASE the reservation so a genuine retry can succeed. The form channel (externalId=null) keeps its current path (no receipt).
- Parsers are pure `(payload) → Result<NormalizedLead>`; validate at boundary with Zod; drop-if-invalid phone/email happens downstream in ingest (parsers only normalize + extract `externalId`). Never throw for expected validation.
- Design principles binding (SOLID/DI/repository/DTO≠domain/no-silent-failures/YAGNI). No floating UI. Functional copy. No dead buttons.
- Angi/Thumbtack payload field maps are from documented sources (Angi Lead Integration API; Thumbtack Leads API). Where a field path is uncertain (Thumbtack phone path, whose docs are JS-rendered), the parser tolerates both the documented and the obvious alternative path and is covered by a test fixture — flagged inline.

## File Structure

**Modify:**
- `modules/inbound/domain/inbound-ports.ts` — `LeadReceiptRepository`: replace `recordIfNew` with `reserve` + `release` (record-first lock).
- `modules/inbound/infra/drizzle-lead-receipt-repository.ts` — implement `reserve`/`release`.
- `modules/inbound/app/ingest-external-lead.ts` — reorder to reserve→create→(release on failure).
- `modules/inbound/app/ingest-external-lead.test.ts` — update for the new ordering + a release-on-failure test.
- `modules/inbound/app/parsers/registry.ts` — register `angi` + `thumbtack`.
- `app/(office)/settings/page.tsx` — render `<LeadMarketplacesCard />` in place of the current static "Lead marketplaces" card (shared file — confined edit).

**Create:**
- `modules/inbound/app/parsers/angi-parser.ts` + `angi-parser.test.ts`
- `modules/inbound/app/parsers/thumbtack-parser.ts` + `thumbtack-parser.test.ts`
- `app/(office)/settings/lead-marketplaces-card.tsx`

---

## Task 1: Receipt-as-lock idempotency refactor

**Files:**
- Modify: `modules/inbound/domain/inbound-ports.ts`, `modules/inbound/infra/drizzle-lead-receipt-repository.ts`, `modules/inbound/app/ingest-external-lead.ts`, `modules/inbound/app/ingest-external-lead.test.ts`

**Interfaces:**
- Produces: `LeadReceiptRepository { reserve(channel, externalId): Promise<boolean>; release(channel, externalId): Promise<void> }`. `reserve` = INSERT `(org,channel,external_id)` ON CONFLICT DO NOTHING → `true` if newly inserted (this caller owns it), `false` if already present (duplicate). `release` deletes the reservation (only used to roll back after a failed create).
- `IngestExternalLeadUseCase.exec` unchanged signature/outcomes (`created|deduped|duplicate_ignored`), new internal ordering.

- [ ] **Step 1: Update the failing tests first**

In `modules/inbound/app/ingest-external-lead.test.ts`, change the fakes from `recordIfNew` to `reserve`/`release`, and update the duplicate test to assert the NEW ordering (reserve happens BEFORE ensure; a duplicate reservation means ensure is NOT called):

```typescript
function makeDeps(opts: { reserved?: boolean; ensureErr?: boolean } = {}) {
  const calls = { ensure: 0, reserve: 0, release: 0, touched: 0 };
  const ensure = { exec: async () => { calls.ensure++; return opts.ensureErr ? err(validation("bad", "name")) : ok({ lead: { props: { id: "lead-1" } }, created: true }); } };
  const receipts = {
    reserve: async () => { calls.reserve++; return !opts.reserved; }, // reserved=true → already seen → reserve returns false
    release: async () => { calls.release++; },
  };
  const endpoints = { touchLastLead: async () => { calls.touched++; } };
  const clock = { now: () => new Date("2026-07-12T00:00:00Z") };
  return { uc: new IngestExternalLeadUseCase(ensure as never, receipts as never, endpoints as never, clock as never), calls };
}
const lead = { name: "Gary", phone: "(925) 555-0100", email: null, address: null, notes: null, externalId: "angi-1" };

it("reserves BEFORE creating; a fresh reservation creates the lead", async () => {
  const { uc, calls } = makeDeps();
  const r = await uc.exec({ channel: "angi", source: "Angi", lead });
  expect(isOk(r) && r.value.outcome).toBe("created");
  expect(calls.reserve).toBe(1);
  expect(calls.ensure).toBe(1);
  expect(calls.release).toBe(0);
  expect(calls.touched).toBe(1);
});

it("ignores a duplicate WITHOUT creating (reserve returns false → ensure never called)", async () => {
  const { uc, calls } = makeDeps({ reserved: true });
  const r = await uc.exec({ channel: "angi", source: "Angi", lead });
  expect(isOk(r) && r.value.outcome).toBe("duplicate_ignored");
  expect(calls.reserve).toBe(1);
  expect(calls.ensure).toBe(0); // the key fix: a retried phoneless lead can't double-create
});

it("releases the reservation when the create fails, so a retry can succeed", async () => {
  const { uc, calls } = makeDeps({ ensureErr: true });
  const r = await uc.exec({ channel: "angi", source: "Angi", lead });
  expect(isErr(r)).toBe(true);
  expect(calls.reserve).toBe(1);
  expect(calls.ensure).toBe(1);
  expect(calls.release).toBe(1); // rolled back → retry re-reserves
});

it("form channel (externalId=null) skips the receipt entirely", async () => {
  const { uc, calls } = makeDeps({ reserved: true });
  const r = await uc.exec({ channel: "form", source: "Website", lead: { ...lead, externalId: null } });
  expect(isOk(r) && r.value.outcome).toBe("created");
  expect(calls.reserve).toBe(0);
  expect(calls.ensure).toBe(1);
});
```
(Import `err`, `validation`, `isErr` from `@mallet/shared/types` alongside the existing `ok`/`isOk`.)

- [ ] **Step 2: Run — expect FAIL** (`reserve`/`release` don't exist)

Run: `npx vitest run modules/inbound/app/ingest-external-lead.test.ts 2>&1 | tail -15`

- [ ] **Step 3: Update the port**

In `modules/inbound/domain/inbound-ports.ts`, replace the `LeadReceiptRepository`:
```typescript
// Idempotency ledger used as a LOCK (record-first): reserve the (channel, externalId) BEFORE the
// create so a retried/duplicate webhook can't double-create. release() rolls back a reservation
// when the create fails, so a genuine retry can proceed.
export interface LeadReceiptRepository {
  reserve(channel: Channel, externalId: string): Promise<boolean>; // true = newly reserved (proceed)
  release(channel: Channel, externalId: string): Promise<void>;
}
```

- [ ] **Step 4: Implement in the repo**

In `modules/inbound/infra/drizzle-lead-receipt-repository.ts`, replace `recordIfNew` (drop the `leadId` column write — it stays nullable in the row):
```typescript
  // INSERT the reservation; a returned row means THIS caller reserved it (new). Empty on conflict.
  async reserve(channel: Channel, externalId: string): Promise<boolean> {
    const rows = await this.tx.insert(inboundLeadReceipts)
      .values({ orgId: this.orgId, channel, externalId })
      .onConflictDoNothing({ target: [inboundLeadReceipts.orgId, inboundLeadReceipts.channel, inboundLeadReceipts.externalId] })
      .returning({ id: inboundLeadReceipts.id });
    return rows.length > 0;
  }

  async release(channel: Channel, externalId: string): Promise<void> {
    await this.tx.delete(inboundLeadReceipts).where(
      and(
        eq(inboundLeadReceipts.orgId, this.orgId),
        eq(inboundLeadReceipts.channel, channel),
        eq(inboundLeadReceipts.externalId, externalId),
      ),
    );
  }
```
(Add `and`, `eq`, `delete` usage — import `and, eq` from `drizzle-orm` if not present. `leadId` column becomes always-null now; leave the column in the schema — it's harmless and additive-only rules forbid dropping it.)

- [ ] **Step 5: Reorder the use-case**

In `modules/inbound/app/ingest-external-lead.ts`, rewrite `exec` to reserve-first:
```typescript
  async exec(input: IngestInput): Promise<Result<{ outcome: IngestOutcome }, AppError>> {
    const { channel, source, lead } = input;

    // Record-first idempotency LOCK: for a channel that carries a stable external id (marketplaces),
    // reserve it before creating. A duplicate reservation means we already ingested this lead — skip
    // the create entirely (crucial for phoneless leads, which dedupe-by-phone can't catch on retry).
    if (lead.externalId) {
      const reserved = await this.receipts.reserve(channel, lead.externalId);
      if (!reserved) {
        logger.info({ channel }, "inbound.duplicate_ignored");
        return ok({ outcome: "duplicate_ignored" });
      }
    }

    const phone = this.parsePhone(lead.phone);
    const email = lead.email && EMAIL_RE.test(lead.email) ? lead.email : null;
    const result = await this.ensureCustomer.exec({
      name: lead.name, phone, email, source,
      companyId: null, role: null, notes: lead.notes, address: lead.address,
    });
    if (!isOk(result)) {
      // Roll back the reservation so a genuine retry isn't wrongly treated as a duplicate.
      if (lead.externalId) await this.receipts.release(channel, lead.externalId);
      logger.info({ channel }, "inbound.ensure_failed");
      return result;
    }

    await this.endpoints.touchLastLead(channel, this.clock.now());
    const outcome = result.value.created ? "created" : "deduped";
    logger.info({ channel, outcome }, `inbound.${outcome}`);
    return ok({ outcome });
  }
```
Extract the phone parse to a small private method to keep `exec` under 20 lines:
```typescript
  private parsePhone(raw: string | null) {
    if (!raw) return null;
    const parsed = Phone.parse(raw);
    return isOk(parsed) ? parsed.value : null;
  }
```
(Keep the existing `EMAIL_RE`, imports, and the `NOTE` comment updated to reflect record-first.)

- [ ] **Step 6: Run — expect PASS**

Run: `npx vitest run modules/inbound/app/ingest-external-lead.test.ts 2>&1 | tail -10` → PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 7: Commit**

```bash
git add modules/inbound/domain/inbound-ports.ts modules/inbound/infra/drizzle-lead-receipt-repository.ts modules/inbound/app/ingest-external-lead.ts modules/inbound/app/ingest-external-lead.test.ts
git commit -m "refactor(inbound): record-first idempotency (reserve→create→release) so webhook retries can't double-create"
```

---

## Task 2: Angi lead parser

**Files:**
- Create: `modules/inbound/app/parsers/angi-parser.ts`, `modules/inbound/app/parsers/angi-parser.test.ts`

**Interfaces:**
- Consumes: `LeadParser`, `NormalizedLead` (domain).
- Produces: `AngiLeadParser` (impl `LeadParser`). Maps the Angi Lead Integration API payload.

- [ ] **Step 1: Write failing tests** (field map from Angi's documented payload)

Create `modules/inbound/app/parsers/angi-parser.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { AngiLeadParser } from "./angi-parser";
import { isOk, isErr } from "@mallet/shared/types";
const p = new AngiLeadParser();
const unwrap = <T>(r: { ok: true; value: T } | { ok: false }) => { if (!r.ok) throw new Error("err"); return r.value; };

const sample = {
  name: "Gary Pratt", primaryPhone: "(925) 555-0100", email: "gary@x.com",
  address: "1 Pine Rd", city: "Oakland", stateProvince: "CA", postalCode: "94601",
  taskName: "Water heater repair", comments: "No hot water since Tuesday",
  leadOid: 887766, srOid: 445, fee: 35.0,
};

describe("AngiLeadParser", () => {
  it("maps the documented Angi fields to a NormalizedLead", () => {
    const v = unwrap(p.parse(sample) as never);
    expect(v.name).toBe("Gary Pratt");
    expect(v.phone).toBe("(925) 555-0100");
    expect(v.email).toBe("gary@x.com");
    expect(v.address).toBe("1 Pine Rd, Oakland CA 94601");
    expect(v.notes).toContain("Water heater repair");
    expect(v.notes).toContain("No hot water since Tuesday");
    expect(v.externalId).toBe("887766"); // leadOid as string — the idempotency key
  });
  it("falls back to firstName + lastName when name is absent", () => {
    const v = unwrap(p.parse({ ...sample, name: undefined, firstName: "Ann", lastName: "Lee" }) as never);
    expect(v.name).toBe("Ann Lee");
  });
  it("rejects a payload with no name and no first/last", () => {
    expect(isErr(p.parse({ ...sample, name: undefined, firstName: undefined, lastName: undefined }))).toBe(true);
  });
  it("requires leadOid (the idempotency key)", () => {
    expect(isErr(p.parse({ ...sample, leadOid: undefined }))).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**. Run: `npx vitest run modules/inbound/app/parsers/angi-parser.test.ts 2>&1 | tail -12`

- [ ] **Step 3: Implement**

Create `modules/inbound/app/parsers/angi-parser.ts`:
```typescript
import { z } from "zod";
import { ok, err, validation, type Result, type ValidationError } from "@mallet/shared/types";
import type { LeadParser } from "../../domain/lead-parser";
import type { NormalizedLead } from "../../domain/normalized-lead";

// Angi Lead Integration API payload (documented fields). leadOid is the stable lead id → idempotency
// key. Address arrives split; we compose a single line. Auth is a partner x-api-key header, handled
// (optionally) at the route; the per-org URL token is the primary credential.
const schema = z.object({
  name: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  primaryPhone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  stateProvince: z.string().optional(),
  postalCode: z.string().optional(),
  taskName: z.string().optional(),
  comments: z.string().optional(),
  leadOid: z.union([z.number(), z.string()]).optional(),
});
const clean = (s: string | undefined): string | null => (s?.trim() ? s.trim() : null);

function composeAddress(d: z.infer<typeof schema>): string | null {
  const street = clean(d.address);
  const region = [clean(d.city), [clean(d.stateProvince), clean(d.postalCode)].filter(Boolean).join(" ")].filter(Boolean).join(" ");
  const full = [street, region].filter(Boolean).join(", ");
  return full || null;
}

export class AngiLeadParser implements LeadParser {
  parse(payload: unknown): Result<NormalizedLead, ValidationError> {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return err(validation("invalid Angi payload", "body"));
    const d = parsed.data;
    const name = clean(d.name) ?? [clean(d.firstName), clean(d.lastName)].filter(Boolean).join(" ").trim();
    if (!name) return err(validation("Angi lead has no name", "name"));
    if (d.leadOid === undefined || d.leadOid === null || String(d.leadOid).trim() === "") {
      return err(validation("Angi lead has no leadOid", "leadOid"));
    }
    const notes = [clean(d.taskName), clean(d.comments)].filter(Boolean).join(" — ") || null;
    return {
      ...ok({
        name: name.slice(0, 255),
        phone: clean(d.primaryPhone),
        email: clean(d.email),
        address: composeAddress(d)?.slice(0, 500) ?? null,
        notes: notes?.slice(0, 2000) ?? null,
        externalId: String(d.leadOid),
      }),
    };
  }
}
```
> The `{ ...ok({...}) }` wrapper is just to satisfy the `Result` return; if the codebase's `ok()` already returns the right shape, `return ok({...})` directly (match how `form-parser.ts` returns).

- [ ] **Step 4: Run — expect PASS**. Run: `npx vitest run modules/inbound/app/parsers/angi-parser.test.ts 2>&1 | tail -10`. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**
```bash
git add modules/inbound/app/parsers/angi-parser.ts modules/inbound/app/parsers/angi-parser.test.ts
git commit -m "feat(inbound): Angi lead parser (documented fields; leadOid → idempotency key)"
```

---

## Task 3: Thumbtack lead parser

**Files:**
- Create: `modules/inbound/app/parsers/thumbtack-parser.ts`, `modules/inbound/app/parsers/thumbtack-parser.test.ts`

**Interfaces:**
- Produces: `ThumbtackLeadParser` (impl `LeadParser`). Maps the Thumbtack Leads API payload (`leadID`, `customer.name` + phone, `request.{title,description}`, `request.location.{city,state,zipCode}`; no email).

- [ ] **Step 1: Write failing tests**

Create `modules/inbound/app/parsers/thumbtack-parser.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { ThumbtackLeadParser } from "./thumbtack-parser";
import { isErr } from "@mallet/shared/types";
const p = new ThumbtackLeadParser();
const unwrap = <T>(r: { ok: true; value: T } | { ok: false }) => { if (!r.ok) throw new Error("err"); return r.value; };

const sample = {
  leadID: "lead_abc123",
  customer: { customerID: "c1", name: "Maria Sanchez", phone: "925-555-0142" },
  request: {
    category: "Plumbing", title: "Leaky faucet", description: "Kitchen faucet drips",
    location: { city: "Fremont", state: "CA", zipCode: "94536" },
  },
};

describe("ThumbtackLeadParser", () => {
  it("maps the documented Thumbtack fields to a NormalizedLead", () => {
    const v = unwrap(p.parse(sample) as never);
    expect(v.name).toBe("Maria Sanchez");
    expect(v.phone).toBe("925-555-0142");
    expect(v.email).toBeNull(); // Thumbtack does not provide email
    expect(v.address).toBe("Fremont CA 94536");
    expect(v.notes).toContain("Leaky faucet");
    expect(v.externalId).toBe("lead_abc123");
  });
  it("tolerates phone at the top level (docs are ambiguous on the exact path)", () => {
    const v = unwrap(p.parse({ ...sample, customer: { customerID: "c1", name: "Maria Sanchez" }, phone: "925-555-0142" }) as never);
    expect(v.phone).toBe("925-555-0142");
  });
  it("rejects a payload with no customer name", () => {
    expect(isErr(p.parse({ ...sample, customer: { customerID: "c1" } }))).toBe(true);
  });
  it("requires leadID (the idempotency key)", () => {
    expect(isErr(p.parse({ ...sample, leadID: undefined }))).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**. Run: `npx vitest run modules/inbound/app/parsers/thumbtack-parser.test.ts 2>&1 | tail -12`

- [ ] **Step 3: Implement**

Create `modules/inbound/app/parsers/thumbtack-parser.ts`:
```typescript
import { z } from "zod";
import { ok, err, validation, type Result, type ValidationError } from "@mallet/shared/types";
import type { LeadParser } from "../../domain/lead-parser";
import type { NormalizedLead } from "../../domain/normalized-lead";

// Thumbtack Leads API payload. leadID is the stable id → idempotency key. Thumbtack does NOT provide
// email. Phone is documented on the customer; some payloads place it at the top level — tolerate both.
// Address is composed from request.location. The per-org URL token is the credential.
const schema = z.object({
  leadID: z.union([z.string(), z.number()]).optional(),
  phone: z.string().optional(),
  customer: z.object({ name: z.string().optional(), phone: z.string().optional() }).optional(),
  request: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    location: z.object({ city: z.string().optional(), state: z.string().optional(), zipCode: z.string().optional() }).optional(),
  }).optional(),
});
const clean = (s: string | undefined): string | null => (s?.trim() ? s.trim() : null);

export class ThumbtackLeadParser implements LeadParser {
  parse(payload: unknown): Result<NormalizedLead, ValidationError> {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return err(validation("invalid Thumbtack payload", "body"));
    const d = parsed.data;
    const name = clean(d.customer?.name);
    if (!name) return err(validation("Thumbtack lead has no customer name", "name"));
    if (d.leadID === undefined || d.leadID === null || String(d.leadID).trim() === "") {
      return err(validation("Thumbtack lead has no leadID", "leadID"));
    }
    const loc = d.request?.location;
    const address = loc
      ? [clean(loc.city), [clean(loc.state), clean(loc.zipCode)].filter(Boolean).join(" ")].filter(Boolean).join(" ") || null
      : null;
    const notes = [clean(d.request?.title), clean(d.request?.description)].filter(Boolean).join(" — ") || null;
    return ok({
      name: name.slice(0, 255),
      phone: clean(d.customer?.phone) ?? clean(d.phone),
      email: null,
      address: address?.slice(0, 500) ?? null,
      notes: notes?.slice(0, 2000) ?? null,
      externalId: String(d.leadID),
    });
  }
}
```

- [ ] **Step 4: Run — expect PASS**. Run: `npx vitest run modules/inbound/app/parsers/thumbtack-parser.test.ts 2>&1 | tail -10`. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**
```bash
git add modules/inbound/app/parsers/thumbtack-parser.ts modules/inbound/app/parsers/thumbtack-parser.test.ts
git commit -m "feat(inbound): Thumbtack lead parser (documented fields; leadID → idempotency key)"
```

---

## Task 4: Register the parsers + regression-test the registry

**Files:**
- Modify: `modules/inbound/app/parsers/registry.ts`, `modules/inbound/app/parsers/registry.test.ts`

**Interfaces:**
- Consumes: `AngiLeadParser`, `ThumbtackLeadParser`.
- Produces: `parserFor("angi")` and `parserFor("thumbtack")` now return their parsers (route enables both channels automatically).

- [ ] **Step 1: Update the registry test**

In `modules/inbound/app/parsers/registry.test.ts`, replace the null-assertions for angi/thumbtack:
```typescript
import { AngiLeadParser } from "./angi-parser";
import { ThumbtackLeadParser } from "./thumbtack-parser";
// ...
  it("returns a parser for every live channel", () => {
    expect(parserFor("form")).toBeInstanceOf(FormLeadParser);
    expect(parserFor("angi")).toBeInstanceOf(AngiLeadParser);
    expect(parserFor("thumbtack")).toBeInstanceOf(ThumbtackLeadParser);
  });
```
(Remove the old "returns null for angi/thumbtack" test.)

- [ ] **Step 2: Run — expect FAIL**. Run: `npx vitest run modules/inbound/app/parsers/registry.test.ts 2>&1 | tail -10`

- [ ] **Step 3: Register**

In `modules/inbound/app/parsers/registry.ts`:
```typescript
import { AngiLeadParser } from "./angi-parser";
import { ThumbtackLeadParser } from "./thumbtack-parser";

const PARSERS: Partial<Record<Channel, LeadParser>> = {
  form: new FormLeadParser(),
  angi: new AngiLeadParser(),
  thumbtack: new ThumbtackLeadParser(),
};
```

- [ ] **Step 4: Run — expect PASS**. `npx vitest run modules/inbound/app/parsers 2>&1 | tail -10`. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**
```bash
git add modules/inbound/app/parsers/registry.ts modules/inbound/app/parsers/registry.test.ts
git commit -m "feat(inbound): enable angi + thumbtack channels in the parser registry"
```

---

## Task 5: Lead marketplaces settings card

**Files:**
- Create: `app/(office)/settings/lead-marketplaces-card.tsx`
- Modify: `app/(office)/settings/page.tsx` (replace the static "Lead marketplaces" FoldCard body with `<LeadMarketplacesCard />` — confined shared-file edit; coordinate with any concurrent Source-list work)

**Interfaces:**
- Consumes: `api.v1.inbound.list/generate/disable`, `FoldCard`.
- Produces: Angi + Thumbtack rows with "Get webhook URL" → reveal the per-shop webhook URL + paste steps; state `Not set up → Awaiting first lead → Connected · last lead <relative>` from `lastLeadAt`. Yelp + Google LSA rows show a muted "Not available yet" (no dead button).

- [ ] **Step 1: Read the current card** — open `app/(office)/settings/page.tsx`, find the `<FoldCard title="Lead marketplaces" ...>` block. Note its exact current content so the replacement is confined to that block.

- [ ] **Step 2: Implement the card**

Create `app/(office)/settings/lead-marketplaces-card.tsx`:
```typescript
"use client";
import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { FoldCard } from "./fold-card";

function origin(): string { return typeof window !== "undefined" ? window.location.origin : ""; }
const rel = (iso: string | null): string => {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

// Webhook-based marketplaces: "connect" mints a per-shop URL to paste into the platform. Angi posts
// JSON to it (x-api-key partner header); Thumbtack posts its Leads webhook. State flips to Connected
// once the first lead actually arrives (last_lead_at set) — not on mint.
function ConnectRow({ channel, label, steps }: { channel: "angi" | "thumbtack"; label: string; steps: string }) {
  const utils = api.useUtils();
  const list = api.v1.inbound.list.useQuery();
  const generate = api.v1.inbound.generate.useMutation({ onSuccess: () => utils.v1.inbound.list.invalidate() });
  const [copied, setCopied] = useState(false);
  const ep = list.data?.find((e) => e.channel === channel);
  const url = ep ? `${origin()}/api/inbound/${channel}/${ep.token}` : "";
  const state = !ep ? "Not set up" : ep.connected ? `Connected · last lead ${rel(ep.lastLeadAt)}` : "Awaiting first lead";

  return (
    <div className="stage-row" style={{ display: "block" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <b>{label}</b>
        <span className="muted" style={{ fontSize: 12 }}>{state}</span>
        {!ep && (
          <button className="btn sm" disabled={generate.isPending} onClick={() => generate.mutate({ channel })}>
            {generate.isPending ? "…" : "Get webhook URL"}
          </button>
        )}
      </div>
      {ep && (
        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input readOnly value={url} style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 8, padding: "7px 9px", fontFamily: "var(--font-mono, monospace)", fontSize: 12 }} />
            <button className="btn sm" onClick={() => { void navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>{steps}</p>
        </div>
      )}
    </div>
  );
}

export function LeadMarketplacesCard() {
  return (
    <FoldCard title="Lead marketplaces" summary="Angi · Thumbtack">
      <ConnectRow channel="angi" label="Angi" steps="In Angi, email crmintegrations@angi.com with this webhook URL to route your leads here." />
      <ConnectRow channel="thumbtack" label="Thumbtack" steps="In Thumbtack → integrations, add this URL as a custom lead webhook." />
      <div className="stage-row">
        <b>Google LSA</b><span className="muted" style={{ fontSize: 12 }}>Not available yet</span>
      </div>
      <div className="stage-row">
        <b>Yelp</b><span className="muted" style={{ fontSize: 12 }}>Not available yet</span>
      </div>
    </FoldCard>
  );
}
```
> Match the exact `.stage-row`/`.btn` classes the existing marketplace card uses — open the current block and mirror its structure so styling stays consistent.

- [ ] **Step 3: Wire it in** — in `app/(office)/settings/page.tsx`, add `import { LeadMarketplacesCard } from "./lead-marketplaces-card";` and replace the entire existing `<FoldCard title="Lead marketplaces" …>…</FoldCard>` with `<LeadMarketplacesCard />`. Confined to that one block.

- [ ] **Step 4: tsc + lint** — `npx tsc --noEmit` → 0; `npx eslint app/(office)/settings/lead-marketplaces-card.tsx "app/(office)/settings/page.tsx"` → 0 errors.

- [ ] **Step 5: Commit**
```bash
git add app/(office)/settings/lead-marketplaces-card.tsx "app/(office)/settings/page.tsx"
git commit -m "feat(inbound): Lead marketplaces card — Angi/Thumbtack webhook URL + connect state"
```

---

## Task 6: Gate + integration tests + screenshots + PR

- [ ] **Step 1: Extend the intake int test** — in `modules/inbound/app/inbound-intake.int.test.ts`, add marketplace cases (the tables already exist on the shared DB from PR A):
  - ingest an Angi payload via `AngiLeadParser` + ingest use-case under `withTenant` → lead created with `source="Angi"`; a SECOND ingest with the SAME `leadOid` → `duplicate_ignored` and still exactly ONE lead (proves record-first idempotency for a real marketplace retry).
  - same for Thumbtack (`leadID`), and a PHONELESS Angi lead retried → still one lead (the case dedupe-by-phone couldn't catch).
  Model on the existing form case in that file. Run: `npm run test:int -- inbound 2>&1 | tail -20`.

- [ ] **Step 2: Full gate**
```bash
npx tsc --noEmit 2>&1 | tail -5           # 0
npm run lint 2>&1 | tail -5               # 0 errors
npm test 2>&1 | tail -6                    # all unit pass
npm run coverage 2>&1 | tail -8            # ≥ 80/75
npm run build 2>&1 | tail -5               # ok
```

- [ ] **Step 3: Screenshot** the Lead marketplaces card: as the E2E owner, Settings → Lead sources → Lead marketplaces → "Get webhook URL" on Angi → screenshot the revealed URL + state. (Dedicated dev port; delete throwaway spec + `git checkout -- next-env.d.ts` after.)

- [ ] **Step 4: PR**
```bash
git push -u origin feat/inbound-marketplaces
gh pr create --base main --title "feat(inbound): Angi + Thumbtack channels + record-first idempotency" --body "<summary + verification table + the SecSources coordination note + note: no migration (reuses PR A tables); token-in-URL is the credential, Angi x-api-key optional hardening deferred>"
```

---

## Self-Review

### Spec coverage
| Requirement | Task |
|---|---|
| Angi channel (parser + enabled) | 2, 4 |
| Thumbtack channel (parser + enabled) | 3, 4 |
| Record-first idempotency (retries can't double-create; phoneless-safe) | 1 |
| Marketplace "Connect" UI (webhook URL + connect-on-first-lead state) | 5 |
| Yelp/Google LSA not built (deferred) | 5 (shown "Not available yet") |
| No schema/migration (reuse PR A tables) | (whole plan) |
| Tenant safety unchanged (token→resolver→withTenant) | (route unchanged; parsers pure) |
| Int test: marketplace ingest + idempotent retry | 6 |

### Placeholder scan
The two "match the existing card's classes" / "return ok directly if the shape matches" notes are verify-against-real-code instructions with the exact file to open, not vague TODOs. Thumbtack phone-path ambiguity is handled by the parser tolerating both paths + a test for each. No logic step lacks code.

### Type consistency
`LeadReceiptRepository` change (`reserve`/`release`) is applied in the port (Task 1), the repo (Task 1), and consumed only by `IngestExternalLeadUseCase` (Task 1) — no other caller (the route constructs the repo and passes it to the use-case; it never calls `recordIfNew` directly — confirm during Task 1). `NormalizedLead` (name/phone/email/address/notes/externalId) is produced identically by all three parsers. `parserFor` returns `LeadParser` for all three live channels.

### Follow-ups
- Angi `x-api-key` verification (defense-in-depth beyond the URL token) — deferred; note in PR.
- Server-side per-token rate limit (carried from PR A) — still applies to all public inbound routes; deferred.
- Thumbtack exact phone path / inbound webhook signature — confirm against authenticated Thumbtack docs before a real Thumbtack account is connected; the parser tolerates both documented paths meanwhile.
