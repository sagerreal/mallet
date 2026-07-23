# A2P 10DLC Guided Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each Mallet shop get its texting number A2P-approved through a guided in-app step — Mallet pre-fills everything, generates the compliant consent + Privacy/Terms language, walks the shop through EIN + OTP, and Mallet's TrustHub/ISV API submits the Secondary Customer Profile → Brand → Campaign → number to Twilio/TCR.

**Architecture:** This is "Stripe Connect for texting." It mirrors the existing Connect onboarding exactly (`modules/settings/app/connect-onboarding.ts`): a **gateway port** wrapping the external provider, a **use case** that persists each external SID in its OWN committed transaction BEFORE the next fallible external call (so a mid-sequence failure resumes instead of orphaning a real Twilio resource), and a **status projection** the UI polls. New cohesive concern → new module `modules/a2p`. Per-org registration state lives in a new org-scoped `a2p_registrations` table (one row per org). The Twilio SDK is touched in exactly one new infra file, injected behind a transport seam for tests — same discipline as `twilio-sms-sender.ts`.

**Tech Stack:** Next.js 16 (App Router, `"use client"`), tRPC v11, Drizzle + Supabase Postgres (RLS), Zustand store, Twilio Node SDK (`twilio` — already a dependency), Vitest (+ integration config).

## Global Constraints

- **Tenant safety:** org id ALWAYS from `ctx.principal.orgId`, never client input. `a2p_registrations` is org-scoped → hand-written RLS (`ENABLE` + `FORCE ROW LEVEL SECURITY` + `FOR ALL USING/WITH CHECK (org_id = current_org_id())`) as a SEPARATE numbered migration; drizzle-kit does not emit RLS.
- **Result discipline:** expected failures return `Result<T, AppError>` via `ok()`/`err()`; ports return typed `ExternalServiceError` and NEVER throw provider internals across the boundary. No throws for expected validation.
- **Durable-before-fallible ordering:** every external SID (profile/brand/campaign/messaging-service) is persisted in its own committed tx immediately after creation, BEFORE the next external call — copy the ordering in `BeginConnectOnboardingUseCase`.
- **Twilio SDK isolation:** only `modules/a2p/infra/twilio-a2p-gateway.ts` imports `twilio`. Inject an operations seam (like `SmsTransport` in `twilio-sms-sender.ts`) so unit tests never hit a live account.
- **Money/logging:** never log PII (EIN, names, phone numbers) — log SIDs and status codes only (mirror `twilio-sms-sender.ts` logging).
- **Migrations are single-writer:** before `npm run db:generate`, check `gh pr list` for open PRs touching `shared/db/migrations/`. Next free number is `0084` (latest applied is `0083_thankful_omega_red.sql`).
- **Config optional:** all Twilio/A2P env vars are `.optional()` in `shared/config`; without them the gateway degrades to a logging stub (mirror the notification-sender degradation pattern) so dev/test boots without secrets.
- **ISV prerequisite (human, one-time):** Mallet's Primary Customer Profile must be APPROVED with Business Identity = "ISV Reseller or Partner" in the Twilio Console before any secondary profile submits. This is an Owen task, not code — noted in Task 6.

**Reference — verified Twilio ISV sequence** (`client` = Twilio Node SDK):
1. `client.trusthub.v1.customerProfiles.create({ email, friendlyName, policySid: <secondary-profile-policy>, statusCallback })`
2. `client.trusthub.v1.endUsers.create({ type: "customer_profile_business_information", attributes: {...business} })`
3. attach business info: `client.trusthub.v1.customerProfiles(profileSid).customerProfilesEntityAssignments.create({ objectSid: endUserSid })`
4. `client.trusthub.v1.endUsers.create({ type: "authorized_representative_1", attributes: {...contact} })` + attach
5. `client.addresses.create({...})` → `client.trusthub.v1.supportingDocuments.create({ type: "customer_profile_address", attributes: { address_sids } })` + attach
6. attach primary profile SID as an entity assignment
7. `client.trusthub.v1.customerProfiles(profileSid).customerProfilesEvaluations.create({ policySid })` → returns `compliant`/`noncompliant`
8. `client.trusthub.v1.customerProfiles(profileSid).update({ status: "pending-review" })` → **async**, resolves to `twilio-approved`/`twilio-rejected` via status callback
9. Brand: `client.messaging.v1.brandRegistrations.create({ customerProfileBundleSid, a2PProfileBundleSid })` → **async** TCR review
10. Messaging Service: `client.messaging.v1.services.create({ friendlyName })`
11. Campaign: `client.messaging.v1.services(serviceSid).usAppToPerson.create({ brandRegistrationSid, description, messageSamples, usAppToPersonUsecase: "LOW_VOLUME", hasEmbeddedLinks: true, hasEmbeddedPhone: true, messageFlow, optInMessage, ... })` → **async**
12. attach number: `client.messaging.v1.services(serviceSid).phoneNumbers.create({ phoneNumberSid })`

Statuses to track per step: `draft` → `pending-review` → `twilio-approved` | `twilio-rejected` (profile/brand); campaign `IN_PROGRESS` → `VERIFIED` | `FAILED`. Exact param names/policy SIDs: confirm against https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api at implementation time — pin them in Task 6 as named constants.

---

## File Structure

```
modules/a2p/
  domain/
    registration.ts              # A2pRegistration aggregate + state machine (pure)
    registration-repository.ts   # RegistrationRepository port
    a2p-gateway.ts               # A2pGateway port (all external ops)
  app/
    begin-registration.ts        # BeginA2pRegistrationUseCase (orchestration, durable ordering)
    advance-registration.ts      # AdvanceA2pRegistrationUseCase (resume/poll after async steps)
    get-status.ts                # GetA2pStatusUseCase (project to UI view)
    generate-consent.ts          # buildConsentLanguage / buildSampleMessages / buildSmsTerms (pure)
  infra/
    twilio-a2p-gateway.ts        # TwilioA2pGateway (ONLY file importing twilio for A2P)
    drizzle-registration-repository.ts
    registration-mapper.ts
  api/
    a2p-dto.ts                   # zod DTOs
    a2p-router.ts                # tRPC router (begin / submitBusinessInfo / getStatus)
  index.ts                       # barrel

shared/db/schema/a2p-registrations.ts   # new table
shared/db/migrations/0084_a2p_registrations.sql       # table (drizzle-generated)
shared/db/migrations/0085_a2p_registrations_rls.sql   # hand-written RLS

app/(office)/settings/a2p/                # guided wizard UI
  a2p-registration-card.tsx
  a2p-business-form.tsx
  a2p-consent-preview.tsx
  a2p-status.tsx
features/a2p/a2p-hydrator.tsx             # store hydration
lib/store/slices/a2p-slice.ts             # Zustand slice
app/api/webhooks/twilio-a2p/route.ts      # status callback endpoint
```

---

## Phase 0 — Data model + config

### Task 1: `a2p_registrations` table + schema + RLS

**Files:**
- Create: `shared/db/schema/a2p-registrations.ts`
- Modify: `shared/db/schema/index.ts` (export the new table)
- Create: `shared/db/migrations/0084_a2p_registrations.sql` (via `db:generate`)
- Create: `shared/db/migrations/0085_a2p_registrations_rls.sql` (hand-written)

**Interfaces:**
- Produces: the `a2pRegistrations` Drizzle table with columns: `orgId` (uuid, FK→orgs, unique), `status` (text: `not_started`/`collecting`/`profile_pending`/`brand_pending`/`campaign_pending`/`number_pending`/`active`/`failed`), `secondaryProfileSid`, `brandSid`, `messagingServiceSid`, `campaignSid`, `phoneNumberSid` (all text nullable), `businessInfo` (jsonb nullable — the collected form, NO EIN in logs), `otpVerified` (boolean default false), `failureReason` (text nullable), `createdAt`/`updatedAt`.

- [ ] **Step 1: Write the schema file**

```typescript
// shared/db/schema/a2p-registrations.ts
import { pgTable, uuid, text, boolean, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// One A2P 10DLC registration per org (the shop's own Brand + Campaign as an ISV secondary profile).
// Each external SID is stored the moment Twilio returns it, before the next fallible call, so a
// mid-sequence failure resumes rather than orphaning a Twilio resource (mirrors Stripe Connect).
export const a2pRegistrations = pgTable(
  "a2p_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id),
    // State machine — see modules/a2p/domain/registration.ts for legal transitions.
    status: text("status").notNull().default("not_started"),
    secondaryProfileSid: text("secondary_profile_sid"),
    brandSid: text("brand_sid"),
    messagingServiceSid: text("messaging_service_sid"),
    campaignSid: text("campaign_sid"),
    phoneNumberSid: text("phone_number_sid"),
    // The collected business form (legal name, address, industry, EIN-or-null, contact). PII —
    // never logged; only SIDs/status are logged elsewhere.
    businessInfo: jsonb("business_info"),
    otpVerified: boolean("otp_verified").notNull().default(false),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("a2p_registrations_org_uidx").on(t.orgId)],
);
```

- [ ] **Step 2: Export from the schema barrel**

Add to `shared/db/schema/index.ts`: `export * from "./a2p-registrations";`

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new `shared/db/migrations/0084_*.sql` creating `a2p_registrations`. Rename it to `0084_a2p_registrations.sql` and update the journal entry name to match if needed. Verify with `git status shared/db/migrations`.

- [ ] **Step 4: Hand-write the RLS migration**

```sql
-- shared/db/migrations/0085_a2p_registrations_rls.sql
ALTER TABLE "a2p_registrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "a2p_registrations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "a2p_registrations_tenant_isolation" ON "a2p_registrations"
  FOR ALL
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
```

Add a matching entry to the migration journal (copy the shape of the existing `*_rls.sql` journal entries, e.g. `0071_frontdesk_rls`).

- [ ] **Step 5: Apply and verify**

Run: `npm run db:migrate && npm run db:verify`
Expected: `db:verify` exits 0 (journal matches live). Then confirm the table + RLS exist:
Run: `psql "$APP_DATABASE_URL" -c "\d a2p_registrations"` — expect the columns above and `Policies` listing the tenant isolation policy.

- [ ] **Step 6: Commit**

```bash
git add shared/db/schema/a2p-registrations.ts shared/db/schema/index.ts shared/db/migrations/0084_a2p_registrations.sql shared/db/migrations/0085_a2p_registrations_rls.sql shared/db/migrations/meta
git commit -m "feat(a2p): a2p_registrations table + tenant RLS"
```

### Task 2: A2P config env vars

**Files:**
- Modify: `shared/config/index.ts` (add optional env vars near the existing `TWILIO_*` block, ~line 28)

**Interfaces:**
- Produces: `config.TWILIO_PRIMARY_PROFILE_SID`, `config.TWILIO_A2P_STATUS_CALLBACK_URL` available (both optional strings).

- [ ] **Step 1: Add the vars to the zod schema**

In `shared/config/index.ts`, alongside `TWILIO_WEBHOOK_URL`:

```typescript
  // A2P 10DLC ISV registration. Both optional: without the primary profile SID the A2pGateway
  // degrades to a logging stub (dev/test boot without secrets). The status callback is where Twilio
  // posts async brand/campaign approval results (see app/api/webhooks/twilio-a2p/route.ts).
  TWILIO_PRIMARY_PROFILE_SID: z.string().min(1).optional(),
  TWILIO_A2P_STATUS_CALLBACK_URL: z.url().optional(),
```

- [ ] **Step 2: Add to `.env.example`**

Append to `.env.example`:
```
TWILIO_PRIMARY_PROFILE_SID=
TWILIO_A2P_STATUS_CALLBACK_URL=
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` → PASS
```bash
git add shared/config/index.ts .env.example
git commit -m "feat(a2p): config env vars for ISV registration"
```

---

## Phase 1 — Domain (pure, no I/O)

### Task 3: The registration aggregate + state machine

**Files:**
- Create: `modules/a2p/domain/registration.ts`
- Test: `modules/a2p/domain/registration.test.ts`

**Interfaces:**
- Produces:
  - `type A2pStatus = "not_started" | "collecting" | "profile_pending" | "brand_pending" | "campaign_pending" | "number_pending" | "active" | "failed"`
  - `interface BusinessInfo { legalName: string; ein: string | null; addressStreet: string; addressCity: string; addressRegion: string; addressPostal: string; industry: string; websiteUrl: string; contactFirstName: string; contactLastName: string; contactEmail: string; contactPhone: string; }`
  - `interface A2pRegistrationProps { orgId: string; status: A2pStatus; secondaryProfileSid: string | null; brandSid: string | null; messagingServiceSid: string | null; campaignSid: string | null; phoneNumberSid: string | null; businessInfo: BusinessInfo | null; otpVerified: boolean; failureReason: string | null; }`
  - `class A2pRegistration` with static `create(props): Result<A2pRegistration, ValidationError>`, getters, and immutable transition methods: `withBusinessInfo(info)`, `withProfile(sid)`, `withBrand(sid)`, `withMessagingService(sid)`, `withCampaign(sid)`, `withNumber(sid)`, `markActive()`, `markFailed(reason)`. Each returns a NEW instance (immutability rule). Illegal transitions return `err(validation(...))`.
  - `function brandKind(info: BusinessInfo): "standard" | "sole_proprietor"` — `sole_proprietor` when `ein === null`, else `standard`.

- [ ] **Step 1: Write the failing test**

```typescript
// modules/a2p/domain/registration.test.ts
import { describe, it, expect } from "vitest";
import { A2pRegistration, brandKind, type BusinessInfo } from "./registration";

const info: BusinessInfo = {
  legalName: "Summit Plumbing LLC", ein: "12-3456789",
  addressStreet: "200 Ray St", addressCity: "Pleasanton", addressRegion: "CA",
  addressPostal: "94566", industry: "CONSTRUCTION", websiteUrl: "https://summit.example",
  contactFirstName: "Sam", contactLastName: "Rivera", contactEmail: "sam@summit.example",
  contactPhone: "+19255550100",
};

describe("A2pRegistration state machine", () => {
  it("starts not_started and advances profile→brand→campaign→number→active", () => {
    const r0 = A2pRegistration.create({ orgId: "o1", status: "not_started", secondaryProfileSid: null, brandSid: null, messagingServiceSid: null, campaignSid: null, phoneNumberSid: null, businessInfo: null, otpVerified: false, failureReason: null });
    expect(r0.ok).toBe(true);
    if (!r0.ok) throw new Error();
    const r1 = r0.value.withBusinessInfo(info);       // → collecting
    expect(r1.props.status).toBe("collecting");
    const r2 = r1.withProfile("BUxxx");                // → profile_pending
    expect(r2.props.status).toBe("profile_pending");
    expect(r2.props.secondaryProfileSid).toBe("BUxxx");
    const r3 = r2.withBrand("BNxxx").withMessagingService("MGxxx"); // → brand_pending
    expect(r3.props.status).toBe("brand_pending");
    const r4 = r3.withCampaign("QExxx");               // → campaign_pending
    expect(r4.props.status).toBe("campaign_pending");
    const r5 = r4.withNumber("PNxxx").markActive();    // → active
    expect(r5.props.status).toBe("active");
    // immutability: the original is untouched
    expect(r0.value.props.status).toBe("not_started");
  });

  it("brandKind is sole_proprietor without an EIN, standard with one", () => {
    expect(brandKind(info)).toBe("standard");
    expect(brandKind({ ...info, ein: null })).toBe("sole_proprietor");
  });

  it("markFailed records a reason and status failed from any state", () => {
    const r = A2pRegistration.create({ orgId: "o1", status: "brand_pending", secondaryProfileSid: "BUx", brandSid: "BNx", messagingServiceSid: "MGx", campaignSid: null, phoneNumberSid: null, businessInfo: info, otpVerified: true, failureReason: null });
    if (!r.ok) throw new Error();
    const f = r.value.markFailed("brand rejected by TCR");
    expect(f.props.status).toBe("failed");
    expect(f.props.failureReason).toBe("brand rejected by TCR");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run modules/a2p/domain/registration.test.ts`
Expected: FAIL — cannot find module `./registration`.

- [ ] **Step 3: Implement the aggregate**

```typescript
// modules/a2p/domain/registration.ts
import { ok, err, type Result, type ValidationError } from "@mallet/shared/types";
import { validation } from "@mallet/shared/types";

export type A2pStatus =
  | "not_started" | "collecting" | "profile_pending" | "brand_pending"
  | "campaign_pending" | "number_pending" | "active" | "failed";

export interface BusinessInfo {
  legalName: string; ein: string | null;
  addressStreet: string; addressCity: string; addressRegion: string; addressPostal: string;
  industry: string; websiteUrl: string;
  contactFirstName: string; contactLastName: string; contactEmail: string; contactPhone: string;
}

export interface A2pRegistrationProps {
  orgId: string; status: A2pStatus;
  secondaryProfileSid: string | null; brandSid: string | null;
  messagingServiceSid: string | null; campaignSid: string | null; phoneNumberSid: string | null;
  businessInfo: BusinessInfo | null; otpVerified: boolean; failureReason: string | null;
}

export function brandKind(info: BusinessInfo): "standard" | "sole_proprietor" {
  return info.ein === null ? "sole_proprietor" : "standard";
}

export class A2pRegistration {
  private constructor(readonly props: A2pRegistrationProps) {}

  static create(props: A2pRegistrationProps): Result<A2pRegistration, ValidationError> {
    if (!props.orgId) return err(validation("orgId is required", "orgId"));
    return ok(new A2pRegistration(props));
  }

  private next(patch: Partial<A2pRegistrationProps>): A2pRegistration {
    return new A2pRegistration({ ...this.props, ...patch });
  }

  withBusinessInfo(info: BusinessInfo): A2pRegistration {
    return this.next({ businessInfo: info, status: "collecting" });
  }
  withProfile(sid: string): A2pRegistration {
    return this.next({ secondaryProfileSid: sid, status: "profile_pending" });
  }
  withBrand(sid: string): A2pRegistration {
    return this.next({ brandSid: sid, status: "brand_pending" });
  }
  withMessagingService(sid: string): A2pRegistration {
    return this.next({ messagingServiceSid: sid });
  }
  withCampaign(sid: string): A2pRegistration {
    return this.next({ campaignSid: sid, status: "campaign_pending" });
  }
  withNumber(sid: string): A2pRegistration {
    return this.next({ phoneNumberSid: sid, status: "number_pending" });
  }
  markActive(): A2pRegistration {
    return this.next({ status: "active", failureReason: null });
  }
  markFailed(reason: string): A2pRegistration {
    return this.next({ status: "failed", failureReason: reason });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run modules/a2p/domain/registration.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add modules/a2p/domain/registration.ts modules/a2p/domain/registration.test.ts
git commit -m "feat(a2p): registration aggregate + state machine"
```

### Task 4: The ports (gateway + repository)

**Files:**
- Create: `modules/a2p/domain/a2p-gateway.ts`
- Create: `modules/a2p/domain/registration-repository.ts`

**Interfaces:**
- Produces `A2pGateway` port:
  - `createSecondaryProfile(cmd: { orgId: string; info: BusinessInfo }): Promise<Result<{ profileSid: string }, ExternalServiceError>>`
  - `registerBrand(cmd: { profileSid: string; kind: "standard" | "sole_proprietor" }): Promise<Result<{ brandSid: string }, ExternalServiceError>>`
  - `createMessagingService(cmd: { orgId: string }): Promise<Result<{ messagingServiceSid: string }, ExternalServiceError>>`
  - `registerCampaign(cmd: { messagingServiceSid: string; brandSid: string; content: CampaignContent }): Promise<Result<{ campaignSid: string }, ExternalServiceError>>`
  - `attachNumber(cmd: { messagingServiceSid: string; phoneNumberSid: string }): Promise<Result<void, ExternalServiceError>>`
  - `fetchStatus(cmd: { profileSid: string | null; brandSid: string | null; campaignSid: string | null }): Promise<Result<{ profile: RemoteStatus; brand: RemoteStatus; campaign: RemoteStatus }, ExternalServiceError>>` where `type RemoteStatus = "pending" | "approved" | "rejected" | "unknown"`.
  - `interface CampaignContent { description: string; messageSamples: string[]; consentDescription: string; optInMessage: string; usecase: string; }`
- Produces `RegistrationRepository` port:
  - `get(orgId: string): Promise<A2pRegistration | null>`
  - `save(reg: A2pRegistration): Promise<void>` (upsert by orgId)

- [ ] **Step 1: Write the gateway port**

```typescript
// modules/a2p/domain/a2p-gateway.ts
import type { Result, ExternalServiceError } from "@mallet/shared/types";
import type { BusinessInfo } from "./registration";

export type RemoteStatus = "pending" | "approved" | "rejected" | "unknown";

export interface CampaignContent {
  readonly description: string;
  readonly messageSamples: string[];
  readonly consentDescription: string;
  readonly optInMessage: string;
  readonly usecase: string; // e.g. "LOW_VOLUME"
}

/**
 * Port: everything the A2P module needs from Twilio's TrustHub + Messaging surface. Each method
 * returns a typed ExternalServiceError on failure and never throws provider internals across the
 * boundary. Ordering/idempotency live in the use case, not here.
 */
export interface A2pGateway {
  createSecondaryProfile(cmd: { orgId: string; info: BusinessInfo }): Promise<Result<{ profileSid: string }, ExternalServiceError>>;
  registerBrand(cmd: { profileSid: string; kind: "standard" | "sole_proprietor" }): Promise<Result<{ brandSid: string }, ExternalServiceError>>;
  createMessagingService(cmd: { orgId: string }): Promise<Result<{ messagingServiceSid: string }, ExternalServiceError>>;
  registerCampaign(cmd: { messagingServiceSid: string; brandSid: string; content: CampaignContent }): Promise<Result<{ campaignSid: string }, ExternalServiceError>>;
  attachNumber(cmd: { messagingServiceSid: string; phoneNumberSid: string }): Promise<Result<void, ExternalServiceError>>;
  fetchStatus(cmd: { profileSid: string | null; brandSid: string | null; campaignSid: string | null }): Promise<Result<{ profile: RemoteStatus; brand: RemoteStatus; campaign: RemoteStatus }, ExternalServiceError>>;
}
```

- [ ] **Step 2: Write the repository port**

```typescript
// modules/a2p/domain/registration-repository.ts
import type { A2pRegistration } from "./registration";

export interface RegistrationRepository {
  get(orgId: string): Promise<A2pRegistration | null>;
  save(reg: A2pRegistration): Promise<void>; // upsert by orgId (a2p_registrations_org_uidx)
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` → PASS
```bash
git add modules/a2p/domain/a2p-gateway.ts modules/a2p/domain/registration-repository.ts
git commit -m "feat(a2p): gateway + repository ports"
```

### Task 5: The Drizzle repository + mapper

**Files:**
- Create: `modules/a2p/infra/registration-mapper.ts`
- Create: `modules/a2p/infra/drizzle-registration-repository.ts`
- Test: `modules/a2p/infra/drizzle-registration-repository.int.test.ts`

**Interfaces:**
- Consumes: `A2pRegistration`, `A2pRegistrationProps`, `RegistrationRepository`, the `a2pRegistrations` table, `TenantTx` (from `@mallet/shared/db/tx` — same import the messaging repo uses).
- Produces: `class DrizzleRegistrationRepository implements RegistrationRepository` constructed with `(tx: TenantTx, orgId: OrgId)`; `toDomain(row)` / `toRow(reg)` in the mapper.

- [ ] **Step 1: Write the mapper**

```typescript
// modules/a2p/infra/registration-mapper.ts
import { A2pRegistration, type A2pStatus, type BusinessInfo } from "../domain/registration";

type Row = {
  orgId: string; status: string;
  secondaryProfileSid: string | null; brandSid: string | null;
  messagingServiceSid: string | null; campaignSid: string | null; phoneNumberSid: string | null;
  businessInfo: unknown; otpVerified: boolean; failureReason: string | null;
};

export function toDomain(row: Row): A2pRegistration {
  const r = A2pRegistration.create({
    orgId: row.orgId,
    status: row.status as A2pStatus,
    secondaryProfileSid: row.secondaryProfileSid,
    brandSid: row.brandSid,
    messagingServiceSid: row.messagingServiceSid,
    campaignSid: row.campaignSid,
    phoneNumberSid: row.phoneNumberSid,
    businessInfo: (row.businessInfo as BusinessInfo | null) ?? null,
    otpVerified: row.otpVerified,
    failureReason: row.failureReason,
  });
  if (!r.ok) throw new Error(`corrupt a2p_registrations row for org ${row.orgId}`);
  return r.value;
}

export function toRow(reg: A2pRegistration) {
  const p = reg.props;
  return {
    orgId: p.orgId, status: p.status,
    secondaryProfileSid: p.secondaryProfileSid, brandSid: p.brandSid,
    messagingServiceSid: p.messagingServiceSid, campaignSid: p.campaignSid,
    phoneNumberSid: p.phoneNumberSid,
    businessInfo: p.businessInfo, otpVerified: p.otpVerified, failureReason: p.failureReason,
    updatedAt: new Date(),
  };
}
```

- [ ] **Step 2: Write the repository**

```typescript
// modules/a2p/infra/drizzle-registration-repository.ts
import { eq } from "drizzle-orm";
import { a2pRegistrations } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import type { A2pRegistration } from "../domain/registration";
import type { RegistrationRepository } from "../domain/registration-repository";
import { toDomain, toRow } from "./registration-mapper";

export class DrizzleRegistrationRepository implements RegistrationRepository {
  constructor(private readonly tx: TenantTx, private readonly orgId: OrgId) {}

  async get(orgId: string): Promise<A2pRegistration | null> {
    const [row] = await this.tx.select().from(a2pRegistrations).where(eq(a2pRegistrations.orgId, orgId)).limit(1);
    return row ? toDomain(row) : null;
  }

  async save(reg: A2pRegistration): Promise<void> {
    const row = toRow(reg);
    await this.tx
      .insert(a2pRegistrations)
      .values(row)
      .onConflictDoUpdate({ target: a2pRegistrations.orgId, set: row });
  }
}
```

- [ ] **Step 3: Write the integration test (hits the live RLS'd DB)**

```typescript
// modules/a2p/infra/drizzle-registration-repository.int.test.ts
import { describe, it, expect } from "vitest";
import { withTenant } from "@mallet/shared/db/tx";
import { asOrgId } from "@mallet/shared/types";
import { A2pRegistration } from "../domain/registration";
import { DrizzleRegistrationRepository } from "./drizzle-registration-repository";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222"); // E2E fixture org

describe("DrizzleRegistrationRepository (live RLS)", () => {
  it("upserts and reads back a registration for the tenant", async () => {
    await withTenant(ORG, async (tx) => {
      const repo = new DrizzleRegistrationRepository(tx, ORG);
      const created = A2pRegistration.create({ orgId: ORG, status: "profile_pending", secondaryProfileSid: "BUtest", brandSid: null, messagingServiceSid: null, campaignSid: null, phoneNumberSid: null, businessInfo: null, otpVerified: false, failureReason: null });
      if (!created.ok) throw new Error();
      await repo.save(created.value);
      const got = await repo.get(ORG);
      expect(got?.props.secondaryProfileSid).toBe("BUtest");
      expect(got?.props.status).toBe("profile_pending");
    });
  });
});
```

- [ ] **Step 4: Run the int test**

Run: `npm run test:int -- modules/a2p/infra/drizzle-registration-repository.int.test.ts`
Expected: PASS (requires `.env.local` with `APP_DATABASE_URL`; the E2E fixture org exists).

- [ ] **Step 5: Commit**

```bash
git add modules/a2p/infra/registration-mapper.ts modules/a2p/infra/drizzle-registration-repository.ts modules/a2p/infra/drizzle-registration-repository.int.test.ts
git commit -m "feat(a2p): drizzle registration repository + mapper"
```

---

## Phase 2 — Consent/Terms generation (pure)

### Task 6a: Consent + sample-message + SMS-terms generators

**Files:**
- Create: `modules/a2p/app/generate-consent.ts`
- Test: `modules/a2p/app/generate-consent.test.ts`

**Interfaces:**
- Consumes: `BusinessInfo`.
- Produces:
  - `buildConsentDescription(info: BusinessInfo): string` — the carrier-checked opt-in paragraph (the #1 rejection field), naming the business, the opt-in methods, "not a condition of purchase," STOP/HELP. ≥40 chars.
  - `buildSampleMessages(info: BusinessInfo): string[]` — 5 mixed samples (confirmation, reminder, quote, invoice/pay link, two-way), each with STOP, branded with `info.legalName`.
  - `buildOptInMessage(info: BusinessInfo): string` — 20–320 char confirmation with brand, frequency, "Msg & data rates may apply", HELP/STOP.
  - `buildSmsTermsSection(info: BusinessInfo): string` — the SMS clause for the shop's Terms page (program name, rates, frequency, support contact, HELP/STOP).

- [ ] **Step 1: Write the failing test**

```typescript
// modules/a2p/app/generate-consent.test.ts
import { describe, it, expect } from "vitest";
import { buildConsentDescription, buildSampleMessages, buildOptInMessage } from "./generate-consent";
import type { BusinessInfo } from "../domain/registration";

const info = { legalName: "Summit Plumbing", ein: "12-3456789", addressStreet: "", addressCity: "", addressRegion: "", addressPostal: "", industry: "CONSTRUCTION", websiteUrl: "https://summit.example", contactFirstName: "", contactLastName: "", contactEmail: "", contactPhone: "" } as BusinessInfo;

describe("consent generators", () => {
  it("consent description is ≥40 chars, names the business, mentions STOP", () => {
    const c = buildConsentDescription(info);
    expect(c.length).toBeGreaterThanOrEqual(40);
    expect(c).toContain("Summit Plumbing");
    expect(c).toContain("STOP");
  });
  it("produces 5 samples, each branded and containing STOP", () => {
    const s = buildSampleMessages(info);
    expect(s).toHaveLength(5);
    for (const m of s) { expect(m).toContain("Summit Plumbing"); expect(m).toContain("STOP"); }
  });
  it("opt-in message is 20–320 chars with HELP and STOP", () => {
    const m = buildOptInMessage(info);
    expect(m.length).toBeGreaterThanOrEqual(20);
    expect(m.length).toBeLessThanOrEqual(320);
    expect(m).toContain("HELP"); expect(m).toContain("STOP");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run modules/a2p/app/generate-consent.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the generators**

```typescript
// modules/a2p/app/generate-consent.ts
import type { BusinessInfo } from "../domain/registration";

export function buildConsentDescription(info: BusinessInfo): string {
  return `Customers of ${info.legalName} provide their mobile number and agree to receive text messages from ${info.legalName} when they request service, book an appointment, or ask for a quote — by phone, in person, through the business's website contact or booking form (which includes a consent checkbox), or by texting the business's number first. They consent to receive service-related messages such as appointment confirmations, reminders, quotes, invoices, and support replies about their job. Consent is not a condition of purchase. Customers can reply STOP to opt out and HELP for help.`;
}

export function buildSampleMessages(info: BusinessInfo): string[] {
  const b = info.legalName;
  return [
    `${b}: Hi Dana, confirming your appointment Thu 5/8 between 8–10 AM. Reply C to confirm or R to reschedule. Reply STOP to opt out.`,
    `${b}: Reminder — your technician is scheduled to arrive tomorrow between 1–3 PM. Reply STOP to unsubscribe.`,
    `${b}: Your estimate is ready to view and approve here: https://mallet.link/q/8241. Reply STOP to opt out.`,
    `${b}: Invoice #1042 for $450 is ready. Pay securely here: https://mallet.link/pay/1042. Reply HELP for help, STOP to unsubscribe.`,
    `${b}: Thanks for reaching out! Yes, we can come take a look Friday morning. What's the best address for the visit? Reply STOP to opt out.`,
  ];
}

export function buildOptInMessage(info: BusinessInfo): string {
  return `${info.legalName}: You're now subscribed to service updates. Message frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to unsubscribe.`;
}

export function buildSmsTermsSection(info: BusinessInfo): string {
  return `SMS Terms — ${info.legalName}: By providing your mobile number you agree to receive service-related text messages (appointment confirmations, reminders, quotes, invoices, and support). Message frequency varies. Message and data rates may apply. Reply HELP for help or STOP to unsubscribe at any time. Carrier is not liable for delayed or undelivered messages. See our Privacy Policy for how we handle your data.`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run modules/a2p/app/generate-consent.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add modules/a2p/app/generate-consent.ts modules/a2p/app/generate-consent.test.ts
git commit -m "feat(a2p): compliant consent/sample/opt-in/terms generators"
```

---

## Phase 3 — Twilio adapter (infra, the only SDK-touching file)

### Task 6: `TwilioA2pGateway`

> **Owen prerequisite (one-time, human):** In the Twilio Console, ensure Mallet's Primary Customer Profile is APPROVED with Business Identity = "ISV Reseller or Partner", and copy its SID into `TWILIO_PRIMARY_PROFILE_SID`. Secondary profiles cannot submit until this is done.

**Files:**
- Create: `modules/a2p/infra/twilio-a2p-gateway.ts`
- Test: `modules/a2p/infra/twilio-a2p-gateway.test.ts` (unit — injects a fake ops object, no live account)

**Interfaces:**
- Consumes: `A2pGateway`, `CampaignContent`, `BusinessInfo`, config values.
- Produces: `class TwilioA2pGateway implements A2pGateway` constructed with `(accountSid, authToken, primaryProfileSid, statusCallbackUrl, ops?: A2pOps)` where `A2pOps` is the injectable seam (an interface wrapping the ~12 SDK calls). Also `class LoggingA2pGateway implements A2pGateway` (the degradation stub when config is absent — returns fake SIDs and logs, mirroring `logging-notification-sender.ts`).

**Implementation note:** wrap each SDK call in a helper that catches, classifies (4xx deterministic vs 5xx/network), logs SID/status only, and returns `err(externalService("twilio-a2p", ..., retryable))` — copy the classification approach in `twilio-sms-sender.ts`. The exact SDK resource paths + params are in the "Reference — verified Twilio ISV sequence" block at the top of this plan; pin the two policy SIDs and the campaign usecase string as named constants at the top of this file and confirm current values against the Twilio docs URL there.

- [ ] **Step 1: Write the failing unit test (fake ops seam)**

```typescript
// modules/a2p/infra/twilio-a2p-gateway.test.ts
import { describe, it, expect, vi } from "vitest";
import { TwilioA2pGateway, type A2pOps } from "./twilio-a2p-gateway";
import type { BusinessInfo } from "../domain/registration";

const info = { legalName: "Summit Plumbing", ein: "12-3456789", addressStreet: "200 Ray St", addressCity: "Pleasanton", addressRegion: "CA", addressPostal: "94566", industry: "CONSTRUCTION", websiteUrl: "https://s.example", contactFirstName: "Sam", contactLastName: "Rivera", contactEmail: "sam@s.example", contactPhone: "+19255550100" } as BusinessInfo;

const okOps = (): A2pOps => ({
  createCustomerProfile: vi.fn(async () => ({ sid: "BUxxx" })),
  createEndUser: vi.fn(async () => ({ sid: "IThuman" })),
  createAddress: vi.fn(async () => ({ sid: "ADxxx" })),
  createSupportingDocument: vi.fn(async () => ({ sid: "RDxxx" })),
  assignEntity: vi.fn(async () => undefined),
  evaluateProfile: vi.fn(async () => ({ status: "compliant" as const })),
  submitProfile: vi.fn(async () => undefined),
  createBrand: vi.fn(async () => ({ sid: "BNxxx" })),
  createMessagingService: vi.fn(async () => ({ sid: "MGxxx" })),
  createCampaign: vi.fn(async () => ({ sid: "QExxx" })),
  attachNumberToService: vi.fn(async () => undefined),
  fetchProfileStatus: vi.fn(async () => "approved" as const),
  fetchBrandStatus: vi.fn(async () => "approved" as const),
  fetchCampaignStatus: vi.fn(async () => "approved" as const),
});

describe("TwilioA2pGateway", () => {
  it("createSecondaryProfile runs the full TrustHub assembly and returns the profile SID", async () => {
    const ops = okOps();
    const gw = new TwilioA2pGateway("AC", "tok", "BUprimary", "https://cb", ops);
    const r = await gw.createSecondaryProfile({ orgId: "o1", info });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.profileSid).toBe("BUxxx");
    expect(ops.createCustomerProfile).toHaveBeenCalledOnce();
    expect(ops.submitProfile).toHaveBeenCalledWith("BUxxx");
  });

  it("classifies a 4xx from a step as a non-retryable ExternalServiceError", async () => {
    const ops = okOps();
    ops.createBrand = vi.fn(async () => { throw Object.assign(new Error("bad"), { status: 400, code: 21650 }); });
    const gw = new TwilioA2pGateway("AC", "tok", "BUprimary", "https://cb", ops);
    const r = await gw.registerBrand({ profileSid: "BUxxx", kind: "standard" });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run modules/a2p/infra/twilio-a2p-gateway.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the gateway**

Implement `A2pOps` (the seam interface with the methods the test fakes), the real ops factory that builds them from a `twilio()` client using the resource paths in the reference block, and `TwilioA2pGateway` mapping each port method onto the ops with the `twilio-sms-sender.ts` error-classification helper. `createSecondaryProfile` runs steps 1–8+10–11 of the reference sequence (assemble → evaluate → submit); `registerBrand` runs step 9; `createMessagingService` step 10; `registerCampaign` step 11 (passing `content.messageSamples`, `content.consentDescription` as `messageFlow`, `content.optInMessage`, `usAppToPersonUsecase: content.usecase`, `hasEmbeddedLinks: true`, `hasEmbeddedPhone: true`); `attachNumber` step 12; `fetchStatus` reads the three resources and maps provider statuses onto `RemoteStatus`. Add `LoggingA2pGateway` returning deterministic fake SIDs (`BU-stub`, `BN-stub`, …) for when config is absent.

*(Full method bodies follow the `twilio-sms-sender.ts` structure — one try/catch classification helper reused per op. Keep every `console`/logger call to SID + status only, never `info`.)*

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run modules/a2p/infra/twilio-a2p-gateway.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add modules/a2p/infra/twilio-a2p-gateway.ts modules/a2p/infra/twilio-a2p-gateway.test.ts
git commit -m "feat(a2p): Twilio TrustHub/messaging gateway adapter (seam-injected)"
```

---

## Phase 4 — Use cases (app orchestration)

### Task 7: `BeginA2pRegistrationUseCase` (durable ordering)

**Files:**
- Create: `modules/a2p/app/begin-registration.ts`
- Test: `modules/a2p/app/begin-registration.test.ts`

**Interfaces:**
- Consumes: `A2pGateway`, `RegistrationRepository`, `A2pRegistration`, `brandKind`, the consent generators, a `A2pTenantRunner` (copy `SettingsTenantRunner` — `<T>(fn: (repo: RegistrationRepository) => Promise<T>) => Promise<T>`), `Clock`.
- Produces: `class BeginA2pRegistrationUseCase` with `exec(cmd: { orgId: string; info: BusinessInfo; phoneNumberSid: string }): Promise<Result<{ status: A2pStatus }, AppError>>`. Sequence, each external SID persisted in its own committed tx before the next external call: save businessInfo → createSecondaryProfile → save profileSid → registerBrand → save brandSid → createMessagingService → save msgSvcSid → registerCampaign(content from generators) → save campaignSid → attachNumber → save numberSid + status. On any external `err`, `markFailed(reason)` is persisted and the error returned. Re-running resumes from the first missing SID (re-read under a fresh tx before each step — copy the Connect re-check).

- [ ] **Step 1: Write the failing test** (fake gateway + in-memory runner; assert ordering: profile persisted before brand is attempted)

```typescript
// modules/a2p/app/begin-registration.test.ts
import { describe, it, expect, vi } from "vitest";
import { BeginA2pRegistrationUseCase } from "./begin-registration";
import { A2pRegistration, type BusinessInfo } from "../domain/registration";
import type { RegistrationRepository } from "../domain/registration-repository";
import type { A2pGateway } from "../domain/a2p-gateway";
import { ok } from "@mallet/shared/types";

const info = { legalName: "Summit Plumbing", ein: "12-3456789", addressStreet: "x", addressCity: "x", addressRegion: "CA", addressPostal: "94566", industry: "CONSTRUCTION", websiteUrl: "https://s.example", contactFirstName: "S", contactLastName: "R", contactEmail: "s@s.example", contactPhone: "+19255550100" } as BusinessInfo;

function memRepo() {
  let reg: A2pRegistration | null = null;
  const repo: RegistrationRepository = { get: async () => reg, save: async (r) => { reg = r; } };
  const runner = async <T>(fn: (r: RegistrationRepository) => Promise<T>) => fn(repo);
  return { repo, runner, current: () => reg };
}

const gateway = (over: Partial<A2pGateway> = {}): A2pGateway => ({
  createSecondaryProfile: vi.fn(async () => ok({ profileSid: "BUx" })),
  registerBrand: vi.fn(async () => ok({ brandSid: "BNx" })),
  createMessagingService: vi.fn(async () => ok({ messagingServiceSid: "MGx" })),
  registerCampaign: vi.fn(async () => ok({ campaignSid: "QEx" })),
  attachNumber: vi.fn(async () => ok(undefined)),
  fetchStatus: vi.fn(async () => ok({ profile: "pending", brand: "pending", campaign: "pending" })),
  ...over,
});

describe("BeginA2pRegistrationUseCase", () => {
  it("persists each SID before the next external call and ends number_pending", async () => {
    const { repo, runner, current } = memRepo();
    const gw = gateway();
    const uc = new BeginA2pRegistrationUseCase(gw, runner, { now: () => new Date() });
    const r = await uc.exec({ orgId: "o1", info, phoneNumberSid: "PNx" });
    expect(r.ok).toBe(true);
    expect(current()?.props.secondaryProfileSid).toBe("BUx");
    expect(current()?.props.campaignSid).toBe("QEx");
    expect(current()?.props.status).toBe("number_pending");
  });

  it("a brand failure persists the profile SID and marks failed (resumable)", async () => {
    const { repo, runner, current } = memRepo();
    const gw = gateway({ registerBrand: vi.fn(async () => ({ ok: false, error: { kind: "external_service" } }) as any) });
    const uc = new BeginA2pRegistrationUseCase(gw, runner, { now: () => new Date() });
    const r = await uc.exec({ orgId: "o1", info, phoneNumberSid: "PNx" });
    expect(r.ok).toBe(false);
    expect(current()?.props.secondaryProfileSid).toBe("BUx"); // durable — not rolled back
    expect(current()?.props.status).toBe("failed");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run modules/a2p/app/begin-registration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the use case** (mirror `BeginConnectOnboardingUseCase` ordering: read-in-own-tx → external call → save-in-own-tx, re-checking for a concurrent write before each save; call `buildSampleMessages`/`buildConsentDescription`/`buildOptInMessage` to construct `CampaignContent` with `usecase: "LOW_VOLUME"`; `brandKind(info)` chooses the brand kind; on the first `err`, load-modify-`markFailed`-save then return the error).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run modules/a2p/app/begin-registration.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add modules/a2p/app/begin-registration.ts modules/a2p/app/begin-registration.test.ts
git commit -m "feat(a2p): begin-registration use case (durable per-SID ordering)"
```

### Task 8: `AdvanceA2pRegistrationUseCase` (poll async approvals → active)

**Files:**
- Create: `modules/a2p/app/advance-registration.ts`
- Test: `modules/a2p/app/advance-registration.test.ts`

**Interfaces:**
- Consumes: `A2pGateway.fetchStatus`, `RegistrationRepository`, runner.
- Produces: `class AdvanceA2pRegistrationUseCase` with `exec(cmd: { orgId: string }): Promise<Result<{ status: A2pStatus }, AppError>>`. Reads the reg; if profile+brand+campaign all `approved` and a number is attached → `markActive()` + save; if any `rejected` → `markFailed()` + save; else leaves it pending. Called by both the status webhook (Task 12) and a poll.

- [ ] **Step 1: Write the failing test** (fake gateway returns all-approved → expect status `active`; one rejected → `failed`).
- [ ] **Step 2: Run — FAIL (module not found).**
- [ ] **Step 3: Implement** (single tx: read → decide from `fetchStatus` → transition → save).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(a2p): advance-registration use case (async approval → active)`.

### Task 9: `GetA2pStatusUseCase` (UI projection)

**Files:**
- Create: `modules/a2p/app/get-status.ts`
- Test: `modules/a2p/app/get-status.test.ts`

**Interfaces:**
- Produces: `interface A2pStatusView { status: A2pStatus; canText: boolean; needsInput: boolean; failureReason: string | null; }` and `class GetA2pStatusUseCase` with `exec(orgId): Promise<A2pStatusView>` (`canText = status === "active"`, `needsInput = status === "not_started" || status === "failed"`). Returns a `not_started` view when no row exists.

- [ ] **Step 1: Write the failing test** (no row → `not_started`, `canText:false`, `needsInput:true`; active row → `canText:true`).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(a2p): get-status use case (UI projection)`.

---

## Phase 5 — API (tRPC + webhook)

### Task 10: DTOs + `a2p-router`

**Files:**
- Create: `modules/a2p/api/a2p-dto.ts`
- Create: `modules/a2p/api/a2p-router.ts`
- Create: `modules/a2p/index.ts` (barrel exporting the router + the ports/use-cases the composition root needs)
- Modify: the app router registration (wherever module routers are combined, e.g. `modules/**/app-router` or `lib/trpc/root`) to mount `a2p` — follow how `settings` router is mounted.

**Interfaces:**
- Consumes: `BeginA2pRegistrationUseCase`, `GetA2pStatusUseCase`, `A2pStatusView`, the DTOs.
- Produces tRPC procedures under `v1.a2p`:
  - `getStatus` (`ownerOrOffice.query`) → `A2pStatusView`
  - `submitAndRegister` (`ownerOrOffice` — but NoTx style + tenant runner, like Connect's begin) input `businessInfoDTO` → `{ status }`. Uses `ctx.principal.orgId`; reads the org's `twilioNumber`/number SID to pass as `phoneNumberSid`.
- `businessInfoDTO` zod: legalName, ein (`z.string().nullable()`), address fields, industry, websiteUrl (`z.url()`), contact fields, contactEmail (`z.string().email()`), contactPhone (validated with the shared `Phone` VO in a `superRefine`, same pattern as `emergencyTransferNumber` in `settings-dto.ts`).

- [ ] **Step 1: Write the DTO + a router test** (a router unit test asserting `getStatus` returns the projected view for a seeded reg; follow an existing `*-router` test shape).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement DTOs, router, barrel, and mount it.**
- [ ] **Step 4: Run — PASS;** `npx tsc --noEmit` PASS.
- [ ] **Step 5: Commit** `feat(a2p): tRPC router + DTOs (getStatus / submitAndRegister)`.

### Task 11: Twilio status-callback webhook

**Files:**
- Create: `app/api/webhooks/twilio-a2p/route.ts`
- Test: `app/api/webhooks/twilio-a2p/route.test.ts`

**Interfaces:**
- Consumes: `AdvanceA2pRegistrationUseCase`. Validates the Twilio signature (reuse the existing Twilio webhook signature check used by the inbound-SMS/Vapi webhooks — grep `x-twilio-signature` / `validateRequest`), maps the callback's resource SID → orgId (look up `a2p_registrations` by `secondaryProfileSid`/`brandSid`/`campaignSid`), and calls `AdvanceA2pRegistrationUseCase.exec({ orgId })`. Returns 204 always (never leak state); logs SID+status only.

- [ ] **Step 1: Write the failing test** (posts a fake approval callback for a seeded brand SID → expect the reg advanced; invalid signature → 403).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement the route.**
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(a2p): Twilio status-callback webhook → advance registration`.

---

## Phase 6 — Client (guided wizard) + send gating

### Task 12: Store slice + hydrator

**Files:**
- Create: `lib/store/slices/a2p-slice.ts`
- Create: `features/a2p/a2p-hydrator.tsx`
- Modify: `lib/store/app-store.ts` (add `...createA2pSlice(...args)` — follow how `createSettingsSlice` is added)
- Test: `lib/store/slices/a2p-slice.test.ts`

**Interfaces:**
- Produces: `A2pSlice` holding `a2pStatus: A2pStatusView | null` + `setA2pStatus(view)`; `A2pHydrator` calling `api.v1.a2p.getStatus.useQuery({ refetchOnWindowFocus: false })` and `setA2pStatus` on data (mirror `settings-hydrator.tsx`).

- [ ] **Step 1: Slice test** (default null → `setA2pStatus` sets it). **Step 2:** FAIL. **Step 3:** implement slice + hydrator + wire into store. **Step 4:** PASS. **Step 5:** commit `feat(a2p): store slice + hydrator`.

### Task 13: The guided registration wizard UI

**Files:**
- Create: `app/(office)/settings/a2p/a2p-registration-card.tsx` (the entry card: shows status; "Set up texting" when `needsInput`, "Being approved — usually same day" when pending, "Texting active ✓" when active)
- Create: `app/(office)/settings/a2p/a2p-business-form.tsx` (pre-filled from org settings/brand: legal name, address, industry, website; asks EIN [optional — "leave blank if you're a sole proprietor without one"] + contact + the consent checkbox attestation)
- Create: `app/(office)/settings/a2p/a2p-consent-preview.tsx` (read-only preview of the generated consent + sample messages + the SMS Terms clause, using the same generators via a small `v1.a2p.previewConsent` query OR compute client-side from a shared copy — prefer a server `previewConsent` query so there's one source of truth)
- Modify: mount the card in the settings page (follow where `branding-card` / `crew-hours-card` mount)
- Test: `app/(office)/settings/a2p/a2p-registration-card.test.tsx` (four-state matrix: not_started / pending / active / failed render correctly — copy the state-matrix harness from `settings/page.test.tsx` or a `*-card.test.tsx`).

**Interfaces:**
- Consumes: `useA2pStatus` (store selector), `api.v1.a2p.submitAndRegister`, `useSaveFlash`, the `DisclosureRow`/`Field`/`Button` primitives (compose primitives — `docs/design-system.md`; run `pnpm lint` + `lint:css`).

- [ ] **Step 1: Write the four-state card test.** **Step 2:** FAIL. **Step 3:** build the card + form + preview using primitives + tokens (no raw px). **Step 4:** test PASS; `pnpm lint && pnpm lint:css` 0 errors. **Step 5:** commit `feat(a2p): guided registration wizard UI`.

### Task 14: Gate outbound SMS on `active`

**Files:**
- Modify: `modules/messaging/app/send-message.ts` (before constructing the sender, require the org's A2P status is `active`; if not, return `err(precondition("texting not yet approved for this org"))` — reuse the `assertDelivered`/PRECONDITION_FAILED convention noted in CLAUDE.md so INTERACTIVE sends surface it).
- Modify: `modules/frontdesk` / `modules/notifications` outbound paths similarly for interactive sends (background reminders keep graceful degradation).
- Test: extend `modules/messaging/app/send-message.test.ts` — a send for a non-active org returns the precondition error and never calls the transport.

**Interfaces:**
- Consumes: `GetA2pStatusUseCase` (or a narrow `isA2pActive(orgId)` reader) injected into the send path.

- [ ] **Step 1: Write the failing test** (non-active org → send returns precondition error, transport not called; active org → sends). **Step 2:** FAIL. **Step 3:** thread an `a2pActive` check into `SendMessageUseCase`. **Step 4:** PASS. **Step 5:** commit `feat(a2p): gate outbound SMS until the org's 10DLC campaign is active`.

---

## Self-Review notes (verify before executing)

- **Spec coverage:** guided in-app step (Task 13), pre-fill (Task 13 form), generate consent/Terms (Task 6a + preview in Task 13), EIN + brand-kind fork (Task 3 `brandKind`, Task 10 DTO), OTP — **NOTE:** the OTP verification (shop replies YES) is Twilio's own step during profile/number verification; surface it in the pending UI (Task 13) and treat `otpVerified` as informational. If a dedicated OTP trigger endpoint is required by the chosen Twilio flow, add it as Task 10b mirroring `submitAndRegister`. API submission (Tasks 6–11), pending status "being approved ~same day" (Task 13), send-gating (Task 14). ISV/secondary-profile model (Tasks 6–7).
- **Sequencing gotcha:** voice (Vapi) needs no 10DLC — do NOT gate voice on A2P; only gate SMS (Task 14). A new org can answer calls day one while its campaign is pending.
- **Cost/latency:** per-registration Twilio fees (~$4 brand + ~$2/mo campaign) are a COGS line, not code; latency (minutes–days) is why Task 13 shows the pending state and Task 11 webhook flips to active asynchronously.
- **Human prerequisite:** Task 6 header — Primary Customer Profile approved as "ISV Reseller or Partner" before any real submission.
- **Full gate before PR:** `npx tsc --noEmit` · `npm run lint` · `npm run lint:css` · `npm test` · `npm run test:int` · `npm run coverage` (≥80/75) · `npm run build`.
