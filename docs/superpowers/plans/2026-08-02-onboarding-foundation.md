# Onboarding Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new shop lands in the app with the right timezone, a working click-to-call, and a front desk that stays silent until it is actually configured.

**Architecture:** Three independent fixes to what `/welcome` collects and what `org_settings` defaults to. The ZIP already asked for at `/welcome` gains a second job (deriving the timezone); one new field (the owner's mobile) fills `users.callback_number` through an endpoint that already ships; and `front_desk` stops defaulting to `true` so an unconfigured assistant never answers a customer.

**Tech Stack:** Next.js 16 App Router · tRPC v11 · Drizzle + Supabase Postgres with RLS · Zustand · Vitest (unit + `vitest.integration.config.ts`).

## Global Constraints

- Org id ALWAYS from `ctx.principal.orgId`, never client input.
- Money in integer cents in DB/domain; not touched by this plan.
- Migrations are single-writer against a SHARED dev/prod database — additive changes only. Check `gh pr list` for an open PR touching `shared/db/migrations/` before generating one.
- New tenant tables need hand-written RLS. **This plan adds no tables**, only a column default change, so no RLS file is required.
- Compose `components/ui` + `components/shared` primitives and `--space/--type/--radius` tokens. `lint` and `lint:css` FAIL on a raw token.
- UI copy is functional, not chatty. Errors name the problem and the next step.
- No floating UI — panels expand in-flow.
- Full gate before any PR: `npx tsc --noEmit` · `npm run lint` · `npm run lint:css` · `npm test` · `npm run test:int` · `npm run coverage` (≥80 stmts / 75 branches; currently ~92.6/85.7 — do not regress) · `npm run build`.

## Scope

**In this plan:** spec items 1, 2 and 4 — ZIP→timezone derivation, a timezone control, the mobile field, and the `frontDesk` default flip plus its readiness predicate.

**Deliberately deferred to their own plans**, because each is independently shippable and this plan must stand alone:

- **Default tax rate** (spec item 3) — touches money on documents, and unblocks QBO invoice sync. Its own plan, ideally merged first.
- **The dashboard checklist and the orienting question** (spec items 5, 6) — a whole UI surface, and it depends on the readiness predicate Task 5 below produces.

---

### Task 1: ZIP → timezone, as a pure function

The single most consequential wrong default in the app: `org_settings.timezone` is `America/Los_Angeles` for every org, is read by the AI front desk and the in-app agent, and has no UI anywhere. The ZIP is already collected at `/welcome` for the phone number's area code, so the answer is already in hand.

A ZIP3-prefix table is approximate — twelve states straddle a timezone line. That is acceptable ONLY because Task 4 shows the derived value and lets the shop correct it. It must never be silent.

**Files:**
- Create: `lib/geo/zip-timezone.ts`
- Test: `lib/geo/zip-timezone.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `zipToTimezone(zip: string): string | null` — an IANA timezone name, or `null` when the ZIP is unparseable or outside the table. Callers treat `null` as "keep the existing default".

- [ ] **Step 1: Write the failing test**

```ts
// lib/geo/zip-timezone.test.ts
import { describe, it, expect } from "vitest";
import { zipToTimezone } from "./zip-timezone";

/**
 * The ZIP is already asked for at /welcome, to give the shop's phone number a local area code.
 * It answers a second question for free: which timezone the shop is in.
 *
 * That matters because org_settings.timezone defaults to America/Los_Angeles, is read by the AI
 * front desk (build-assistant.ts) and the in-app agent's sense of "today" (read-tools.ts), and has
 * no UI. A Boston shop books Pacific times, permanently, and cannot correct it.
 *
 * A ZIP3 table is APPROXIMATE — twelve states straddle a line. The derived value is therefore
 * shown and correctable, never silent. These tests pin the common cases and the shape of the
 * failure, not perfect geography.
 */

describe("zipToTimezone", () => {
  it("puts a Boston plumber on Eastern — the case the default gets wrong", () => {
    expect(zipToTimezone("02189")).toBe("America/New_York");
  });

  it("puts a Bay Area shop on Pacific", () => {
    expect(zipToTimezone("94566")).toBe("America/Los_Angeles");
  });

  it("handles Central, Mountain and the Arizona exception", () => {
    expect(zipToTimezone("60601")).toBe("America/Chicago");     // Chicago
    expect(zipToTimezone("80202")).toBe("America/Denver");      // Denver
    expect(zipToTimezone("85004")).toBe("America/Phoenix");     // Phoenix — no DST
  });

  it("handles the non-contiguous states", () => {
    expect(zipToTimezone("99501")).toBe("America/Anchorage");   // Anchorage
    expect(zipToTimezone("96813")).toBe("Pacific/Honolulu");    // Honolulu
  });

  it("accepts ZIP+4 and surrounding whitespace", () => {
    expect(zipToTimezone(" 02189-1234 ")).toBe("America/New_York");
  });

  // null means "we do not know" — the caller keeps whatever default it had. It must NOT guess.
  it("returns null for input it cannot read, rather than guessing", () => {
    expect(zipToTimezone("")).toBeNull();
    expect(zipToTimezone("abcde")).toBeNull();
    expect(zipToTimezone("123")).toBeNull();
  });

  it("returns null for a ZIP outside the table rather than falling back to Pacific", () => {
    // 005xx is not a real deliverable range; the point is that a gap yields null.
    expect(zipToTimezone("00500")).toBeNull();
  });

  it("only ever returns timezones the runtime actually knows", () => {
    const zips = ["02189", "94566", "60601", "80202", "85004", "99501", "96813", "33101"];
    for (const zip of zips) {
      const tz = zipToTimezone(zip)!;
      expect(() => new Intl.DateTimeFormat("en-US", { timeZone: tz })).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run lib/geo/zip-timezone.test.ts`
Expected: FAIL — `Failed to resolve import "./zip-timezone"`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/geo/zip-timezone.ts

/**
 * ZIP → IANA timezone.
 *
 * Why this exists: org_settings.timezone defaults to America/Los_Angeles for every org, is read by
 * the AI front desk and the in-app agent, and has no UI. The ZIP is already collected at /welcome
 * for the phone number's area code, so the timezone can be derived rather than asked for.
 *
 * ACCURACY. This is a ZIP3-prefix table, and twelve states straddle a timezone line (FL, IN, KY,
 * TN, ND, SD, NE, KS, TX, MI, OR, ID). Ranges here follow the majority of each block, so a shop on
 * the wrong side of a line gets the wrong answer. That is why the caller must SHOW the derived
 * value and let it be corrected — see the Settings timezone control. Never apply this silently.
 *
 * A gap returns null, meaning "we do not know". Falling back to a default would reintroduce the
 * exact bug: a confident wrong answer nobody was asked to check.
 */

/** Inclusive ZIP3 ranges, in ascending order. */
const ZONES: readonly (readonly [number, number, string])[] = [
  [6, 9, "America/Puerto_Rico"],
  [10, 349, "America/New_York"],
  [350, 369, "America/Chicago"],
  [370, 385, "America/Chicago"],
  [386, 397, "America/Chicago"],
  [398, 399, "America/New_York"],
  [400, 427, "America/New_York"],
  [430, 459, "America/New_York"],
  [460, 479, "America/New_York"],
  [480, 499, "America/New_York"],
  [500, 528, "America/Chicago"],
  [530, 549, "America/Chicago"],
  [550, 567, "America/Chicago"],
  [570, 577, "America/Chicago"],
  [580, 588, "America/Chicago"],
  [590, 599, "America/Denver"],
  [600, 629, "America/Chicago"],
  [630, 658, "America/Chicago"],
  [660, 679, "America/Chicago"],
  [680, 693, "America/Chicago"],
  [700, 714, "America/Chicago"],
  [716, 729, "America/Chicago"],
  [730, 749, "America/Chicago"],
  [750, 797, "America/Chicago"],
  [798, 799, "America/Denver"], // El Paso sits in Mountain while the rest of Texas is Central.
  [800, 816, "America/Denver"],
  [820, 831, "America/Denver"],
  [832, 838, "America/Denver"],
  [840, 847, "America/Denver"],
  [850, 865, "America/Phoenix"], // Arizona does not observe DST — a distinct zone, not Denver.
  [870, 884, "America/Denver"],
  [889, 898, "America/Los_Angeles"],
  [900, 961, "America/Los_Angeles"],
  [967, 968, "Pacific/Honolulu"],
  [970, 979, "America/Los_Angeles"],
  [980, 994, "America/Los_Angeles"],
  [995, 999, "America/Anchorage"],
];

export function zipToTimezone(zip: string | null | undefined): string | null {
  const digits = (zip ?? "").trim().replace(/\D/g, "");
  if (digits.length < 5) return null;

  const prefix = Number(digits.slice(0, 3));
  if (!Number.isFinite(prefix)) return null;

  for (const [lo, hi, tz] of ZONES) {
    if (prefix >= lo && prefix <= hi) return tz;
  }
  return null;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run lib/geo/zip-timezone.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/geo/zip-timezone.ts lib/geo/zip-timezone.test.ts
git commit -m "feat: derive an IANA timezone from a US ZIP

org_settings.timezone is America/Los_Angeles for every org, is read by the AI
front desk and the in-app agent, and has no UI. The ZIP is already collected at
/welcome for the phone number's area code, so the timezone can be derived.

Returns null rather than guessing on a gap: a confident wrong answer nobody was
asked to check is the bug being fixed."
```

---

### Task 2: `timezone` becomes a settable field

`updateConfigInput` in `modules/settings/api/settings-router.ts` has no `timezone` key, so nothing can write it through the API. The domain already validates it (`org-settings.ts:270`, `isValidTimeZone`), and the DTO already returns it (`settings-dto.ts:89`) — only the write path is missing.

**Files:**
- Modify: `modules/settings/api/settings-router.ts` (the `updateConfigInput` object and the `updateConfig` resolver's command)
- Modify: `modules/settings/app/update-config.ts` (command field + pass-through)
- Test: `modules/settings/api/settings-timezone.int.test.ts` (create)

**Interfaces:**
- Consumes: `zipToTimezone` from Task 1 (used by Task 3, not here).
- Produces: `v1.settings.updateConfig({ timezone })` accepts an IANA name and rejects an unknown one with BAD_REQUEST. `v1.settings.get()` returns `config.timezone`.

- [ ] **Step 1: Write the failing integration test**

```ts
// modules/settings/api/settings-timezone.int.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { AuthProvider, Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

/**
 * Timezone was unreachable. The column exists, the domain validates it, the DTO returns it — but
 * updateConfigInput had no key for it, so no UI could ever set it and every org stayed on
 * America/Los_Angeles. The front desk and the in-app agent both read it.
 */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

const ctxFor = (orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: { authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator, paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null, llmClient: null, apiKeyAuthenticator: { authenticate: async () => null }, tokenVerifier: { verify: async () => null }, signupStore: { createOrgForUser: async () => { throw new Error("unused in this test"); } } },
});

suite("org timezone (live DB)", () => {
  let admin: Sql;
  let orgId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('Timezone ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("can be set and read back", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    await caller.v1.settings.updateConfig({ timezone: "America/New_York" });
    expect((await caller.v1.settings.get()).config.timezone).toBe("America/New_York");
  });

  it("refuses a timezone the runtime does not know, rather than storing it", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    await expect(
      caller.v1.settings.updateConfig({ timezone: "Mars/Olympus_Mons" }),
    ).rejects.toThrow();
  });

  it("leaves the timezone alone when the patch does not mention it", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    await caller.v1.settings.updateConfig({ timezone: "America/Denver" });
    await caller.v1.settings.updateConfig({ markupBps: 4000 });
    expect((await caller.v1.settings.get()).config.timezone).toBe("America/Denver");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run --config vitest.integration.config.ts modules/settings/api/settings-timezone.int.test.ts`
Expected: FAIL — the first test rejects, because `timezone` is not a recognised input key.

- [ ] **Step 3: Add the input key**

In `modules/settings/api/settings-router.ts`, inside `updateConfigInput`, directly after the `trade` line:

```ts
  // IANA name. The domain validates it against the runtime's own tz database (isValidTimeZone),
  // so an unknown zone is a BAD_REQUEST rather than a stored value nothing can interpret.
  timezone: z.string().min(1).max(64).optional(),
```

- [ ] **Step 4: Pass it through the use-case**

In `modules/settings/app/update-config.ts`, add to the command interface:

```ts
  readonly timezone?: string;
```

and include it in the object handed to the aggregate's `patch`:

```ts
      timezone: cmd.timezone,
```

Then in the `updateConfig` resolver in `modules/settings/api/settings-router.ts`, add to the command object passed to the use-case:

```ts
              timezone: input.timezone,
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run --config vitest.integration.config.ts modules/settings/api/settings-timezone.int.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add modules/settings/api/settings-router.ts modules/settings/app/update-config.ts modules/settings/api/settings-timezone.int.test.ts
git commit -m "feat: make org timezone settable

The column exists, the domain validates it and the DTO returns it — but
updateConfigInput had no key for it, so nothing could write it and every org
stayed on the America/Los_Angeles default that the front desk and the in-app
agent both read."
```

---

### Task 3: `/welcome` derives the timezone and asks for the mobile

`/welcome` currently asks for a business name and a ZIP. It gains one field — the owner's mobile — and starts sending the derived timezone with provisioning.

The mobile does two jobs. It is `users.callback_number`, without which click-to-call dead-ends in a conflict the user cannot act on; **1 of 81 users currently has one set**, so the endpoint (`v1.calls.setCallbackNumber`, already shipped) exists and nobody has found it. It is also the after-hours emergency transfer target for shops that later turn the front desk on.

**Files:**
- Modify: `app/(auth)/welcome/page.tsx`
- Modify: `modules/identity/api/identity-router.ts` (the `signup` input and the org's initial settings)
- Test: `app/(auth)/welcome/page.test.tsx` (create)

**Interfaces:**
- Consumes: `zipToTimezone(zip)` from Task 1; `v1.calls.setCallbackNumber({ callbackNumber })` (existing).
- Produces: `v1.identity.signup` accepts an optional `timezone: string`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// app/(auth)/welcome/page.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * The one screen between signing in and having a workspace.
 *
 * It asks three things now. The ZIP does double duty — the phone number's area code AND the
 * timezone, which is otherwise America/Los_Angeles forever with no UI to correct it. The mobile is
 * users.callback_number: click-to-call has no other way to learn it, and 1 user out of 81 has one.
 */

const provisionMutate = vi.fn();
const setCallback = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/features/identity/hooks", () => ({
  useEnsureProvisioned: () => ({ mutate: provisionMutate, isPending: false, isError: false, error: null }),
}));
vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: { v1: { calls: { setCallbackNumber: { mutate: setCallback } } } },
}));

import WelcomePage from "./page";

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("the welcome screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    provisionMutate.mockImplementation((_input, opts) => opts?.onSuccess?.({ role: "owner" }));
    setCallback.mockResolvedValue({ callbackNumber: "+16175550142" });
  });

  it("sends the timezone derived from the ZIP", () => {
    render(<WelcomePage />);
    fill("Business name", "Summit Plumbing");
    fill("ZIP code", "02189");
    fill("Your mobile", "(617) 555-0142");
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    expect(provisionMutate.mock.calls[0]![0]).toMatchObject({
      orgName: "Summit Plumbing",
      postalCode: "02189",
      timezone: "America/New_York",
    });
  });

  it("stores the mobile so click-to-call has a number to ring", async () => {
    render(<WelcomePage />);
    fill("Business name", "Summit Plumbing");
    fill("ZIP code", "02189");
    fill("Your mobile", "(617) 555-0142");
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    expect(setCallback).toHaveBeenCalledWith({ callbackNumber: "(617) 555-0142" });
  });

  // The ZIP is the only source of the timezone; an unrecognised one must not invent a zone.
  it("omits the timezone when the ZIP is outside the table", () => {
    render(<WelcomePage />);
    fill("Business name", "Summit Plumbing");
    fill("ZIP code", "00500");
    fill("Your mobile", "(617) 555-0142");
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    expect(provisionMutate.mock.calls[0]![0].timezone).toBeUndefined();
  });

  it("says which timezone it picked — a silent guess is the bug being fixed", () => {
    render(<WelcomePage />);
    fill("ZIP code", "02189");
    expect(screen.getByText(/Eastern/i)).toBeTruthy();
  });

  it("will not submit without all three answers", () => {
    render(<WelcomePage />);
    fill("Business name", "Summit Plumbing");
    fill("ZIP code", "02189");
    expect(screen.getByRole("button", { name: /create workspace/i })).toHaveProperty("disabled", true);
  });

  // Provisioning is the write that matters; a failed callback save must not strand the shop
  // outside its own workspace.
  it("still enters the workspace when saving the mobile fails", async () => {
    setCallback.mockRejectedValue(new Error("offline"));
    render(<WelcomePage />);
    fill("Business name", "Summit Plumbing");
    fill("ZIP code", "02189");
    fill("Your mobile", "(617) 555-0142");
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    await Promise.resolve();
    expect(replace).toHaveBeenCalledWith("/dashboard");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run "app/(auth)/welcome/page.test.tsx"`
Expected: FAIL — no "Your mobile" field exists.

- [ ] **Step 3: Add `timezone` to the signup input**

In `modules/identity/api/identity-router.ts`, inside the `signup` input object, after `postalCode`:

```ts
          // Derived from the ZIP on the client (lib/geo/zip-timezone). Absent when the ZIP is
          // outside the table — the org then keeps the column default rather than a guess.
          timezone: z.string().min(1).max(64).optional(),
```

Then, after `createOrgForUser` resolves and inside the same tenant transaction that provisioning uses, apply it when present. The org's settings row already exists by this point:

```ts
        if (input.timezone) {
          await withTenant(asOrgId(provisioned.orgId), async (tx) => {
            const repo = new DrizzleSettingsRepository(tx, asOrgId(provisioned.orgId));
            const settings = await repo.load();
            const patched = settings.patch({ timezone: input.timezone }, ctx.deps.clock.now());
            if (isOk(patched)) await repo.save(patched.value);
          });
        }
```

Import `DrizzleSettingsRepository` from `@mallet/settings` at the top of the file if it is not already imported.

- [ ] **Step 4: Rewrite the welcome page**

Replace the body of `app/(auth)/welcome/page.tsx` between the `Field label="ZIP code"` block and the closing `</Card>` so the file reads as follows. Keep the existing imports and add the three new ones.

New imports:

```tsx
import { zipToTimezone } from "@/lib/geo/zip-timezone";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { fmtPhone } from "@/lib/format";
```

New state, beside the existing two:

```tsx
  const [mobile, setMobile] = useState("");
```

Derived values, replacing the existing `canSubmit`:

```tsx
  const zipLooksRight = /^\d{5}$/.test(postalCode.trim());
  const timezone = zipToTimezone(postalCode);
  // 10 digits is a US number; 11 with a leading 1 is the same number written differently.
  const mobileDigits = mobile.replace(/\D/g, "");
  const mobileLooksRight = mobileDigits.length === 10 || (mobileDigits.length === 11 && mobileDigits.startsWith("1"));
  const canSubmit =
    orgName.trim().length > 0 && zipLooksRight && mobileLooksRight && !provision.isPending;
```

The submit handler:

```tsx
  function submit() {
    if (!canSubmit) return;
    provision.mutate(
      {
        orgName: orgName.trim(),
        postalCode: postalCode.trim(),
        // Omitted rather than defaulted when the ZIP is unknown: the org keeps the column default
        // and the Settings control is where it gets corrected.
        ...(timezone ? { timezone } : {}),
      },
      {
        onSuccess: (me) => {
          // Fire-and-forget: provisioning is the write that matters, and a failed callback save
          // must not strand the shop outside the workspace it just paid attention to create.
          // It is recoverable from Settings; being locked out of the app is not.
          void trpcVanilla.v1.calls.setCallbackNumber.mutate({ callbackNumber: mobile }).catch(() => {});
          router.replace(me.role === "tech" ? "/my-day" : "/dashboard");
        },
      },
    );
  }
```

The mobile field, placed after the ZIP field:

```tsx
      <Field label="Your mobile">
        <Input
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
          placeholder="(617) 555-0142"
          inputMode="tel"
          autoComplete="tel"
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
      </Field>
```

The explanatory copy, replacing the existing single paragraph:

```tsx
      <p style={{ fontSize: "var(--type-sm)", color: "var(--ink-2)", margin: "0 0 var(--space-4)" }}>
        We&rsquo;ll get you a business number in your area code. Your customers see that number
        instead of anyone&rsquo;s personal phone — we ring your mobile and bridge the call.
        {timezone ? ` Times will show in ${TZ_LABEL[timezone] ?? timezone}; change it in Settings.` : ""}
      </p>
```

And the label map, above the component:

```tsx
/** Plain names for the zones the ZIP table can produce. A shop reads "Eastern", not "America/New_York". */
const TZ_LABEL: Record<string, string> = {
  "America/New_York": "Eastern time",
  "America/Chicago": "Central time",
  "America/Denver": "Mountain time",
  "America/Phoenix": "Arizona time",
  "America/Los_Angeles": "Pacific time",
  "America/Anchorage": "Alaska time",
  "Pacific/Honolulu": "Hawaii time",
  "America/Puerto_Rico": "Atlantic time",
};
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run "app/(auth)/welcome/page.test.tsx"`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add "app/(auth)/welcome/page.tsx" "app/(auth)/welcome/page.test.tsx" modules/identity/api/identity-router.ts
git commit -m "feat: welcome derives the timezone and captures the owner's mobile

The ZIP already picked the phone number's area code; it now also picks the
timezone, which was America/Los_Angeles for every org with no UI to correct it.

The mobile fills users.callback_number — click-to-call has no other way to learn
it, and 1 user out of 81 has one set, so the endpoint shipped and nobody found
it. Saved fire-and-forget: provisioning is the write that matters, and a failed
callback save must not lock a shop out of the workspace it just created."
```

---

### Task 4: A timezone control in Settings

The derived value is a guess from a prefix table. Twelve states straddle a line, so it must be visible and correctable. There is no timezone control anywhere in the app today.

**Files:**
- Create: `app/(office)/settings/timezone-card.tsx`
- Create: `app/(office)/settings/timezone-card.test.tsx`
- Modify: `app/(office)/settings/page.tsx` (mount it in `SecWorkspace`, after the existing workspace fields)

**Interfaces:**
- Consumes: `v1.settings.updateConfig({ timezone })` from Task 2; `v1.settings.get()` for the current value.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// app/(office)/settings/timezone-card.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * The timezone is DERIVED from a ZIP prefix table, and twelve states straddle a line. A shop on
 * the wrong side of one needs to fix it in a click — which is why the derived value is shown at
 * signup rather than applied silently, and why this control has to exist at all. Before this,
 * nothing in the app could change org_settings.timezone.
 */

const updateConfig = vi.fn();
const invalidate = vi.fn();

vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      settings: {
        get: { useQuery: () => ({ data: { config: { timezone: "America/Los_Angeles" } }, isFetched: true }) },
        updateConfig: { useMutation: () => ({ mutate: updateConfig, isPending: false }) },
      },
    },
    useUtils: () => ({ v1: { settings: { get: { invalidate } } } }),
  },
}));

import { TimezoneCard } from "./timezone-card";

describe("the timezone control", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the zone the shop is currently on, in words", () => {
    render(<TimezoneCard />);
    expect(screen.getByDisplayValue("Pacific time")).toBeTruthy();
  });

  it("saves a corrected zone as an IANA name", () => {
    render(<TimezoneCard />);
    fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "America/New_York" } });
    expect(updateConfig).toHaveBeenCalledWith(
      { timezone: "America/New_York" },
      expect.anything(),
    );
  });

  it("names what the setting affects — an abstract 'time zone' means nothing on its own", () => {
    render(<TimezoneCard />);
    expect(screen.getByText(/front desk/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run "app/(office)/settings/timezone-card.test.tsx"`
Expected: FAIL — `Failed to resolve import "./timezone-card"`.

- [ ] **Step 3: Write the card**

```tsx
// app/(office)/settings/timezone-card.tsx
"use client";

import { api } from "@/lib/trpc/client";
import { Field } from "@/components/ui/input";
import { useSaveFlash, SavedFlash } from "@/components/shared/save-flash";

/**
 * Which clock the shop runs on.
 *
 * Derived from the ZIP at signup, because org_settings.timezone was America/Los_Angeles for every
 * org and nothing could change it. The derivation is a prefix table and twelve states straddle a
 * line, so this control is the correction path — not an afterthought.
 */

const ZONES: readonly (readonly [string, string])[] = [
  ["America/New_York", "Eastern time"],
  ["America/Chicago", "Central time"],
  ["America/Denver", "Mountain time"],
  ["America/Phoenix", "Arizona time"],
  ["America/Los_Angeles", "Pacific time"],
  ["America/Anchorage", "Alaska time"],
  ["Pacific/Honolulu", "Hawaii time"],
  ["America/Puerto_Rico", "Atlantic time"],
];

export function TimezoneCard() {
  const utils = api.useUtils();
  const settings = api.v1.settings.get.useQuery();
  const flash = useSaveFlash();
  const save = api.v1.settings.updateConfig.useMutation();

  const current = settings.data?.config.timezone ?? "America/Los_Angeles";

  return (
    <Field label="Time zone">
      <select
        className="sel"
        aria-label="Time zone"
        value={current}
        onChange={(e) =>
          save.mutate(
            { timezone: e.target.value },
            {
              onSuccess: () => {
                void utils.v1.settings.get.invalidate();
                flash.flash();
              },
            },
          )
        }
      >
        {ZONES.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <p className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>
        Used by the front desk when it offers appointment times, and by the assistant when it says
        &ldquo;today&rdquo;.
      </p>
      <SavedFlash saved={flash.saved} />
    </Field>
  );
}
```

- [ ] **Step 4: Mount it in Settings**

In `app/(office)/settings/page.tsx`, inside `SecWorkspace`, add the import at the top of the file:

```tsx
import { TimezoneCard } from "./timezone-card";
```

and render it immediately after the existing workspace fields block:

```tsx
        <TimezoneCard />
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run "app/(office)/settings/timezone-card.test.tsx"`
Expected: PASS, 3 tests.

- [ ] **Step 6: Re-baseline the settings screenshot deliberately**

`/settings` is baselined as `settings-workspace`, so this moves pixels.

Run: `E2E_VISUAL=1 npx playwright test e2e/visual.spec.ts -g "settings"`

Confirm the ONLY diff is the new row, then re-baseline that test alone — never a blanket `--update`:

Run: `E2E_VISUAL=1 npx playwright test e2e/visual.spec.ts -g "settings" --update-snapshots`

Include the before/after in the PR body.

- [ ] **Step 7: Commit**

```bash
git add "app/(office)/settings/timezone-card.tsx" "app/(office)/settings/timezone-card.test.tsx" "app/(office)/settings/page.tsx" e2e/visual.spec.ts-snapshots
git commit -m "feat: a timezone control in Settings

The signup derivation is a ZIP-prefix guess and twelve states straddle a line,
so the derived value must be correctable. Nothing in the app could change
org_settings.timezone before this."
```

---

### Task 5: The front desk stops answering by default

`front_desk` defaults to `true`. A shop is handed a phone number pointed at an assistant configured with nobody's hours, nobody's service area and no bookable services — which is precisely the state that produced "the schedule is full" on every call. A shop that never wants an AI receptionist gets one anyway.

Two parts: the default flips for NEW orgs only, and a pure predicate decides when the front desk is ready to be switched on. The predicate is what the deferred checklist plan will consume.

**Files:**
- Modify: `shared/db/schema/org-settings.ts` (the `frontDesk` column default)
- Create: `shared/db/migrations/<next>_front_desk_default_off.sql`
- Modify: `shared/db/migrations/meta/_journal.json`
- Create: `modules/settings/domain/front-desk-readiness.ts`
- Create: `modules/settings/domain/front-desk-readiness.test.ts`
- Modify: `modules/settings/index.ts` (export the predicate)

**Interfaces:**
- Consumes: `OrgSettingsProps` from `modules/settings/domain/org-settings.ts`.
- Produces: `frontDeskReadiness(p: OrgSettingsProps): { ready: boolean; missing: FrontDeskGap[] }` where `type FrontDeskGap = "hours" | "serviceArea" | "services"`.

- [ ] **Step 1: Write the failing test**

```ts
// modules/settings/domain/front-desk-readiness.test.ts
import { describe, it, expect } from "vitest";
import { frontDeskReadiness } from "./front-desk-readiness";
import { baseSettingsProps } from "./org-settings.fixtures";
import type { OrgSettingsProps } from "./org-settings";

/**
 * When the front desk may answer a customer.
 *
 * front_desk defaulted to true, so a brand-new shop was handed a phone number pointed at an
 * assistant that knew nobody's hours, no service area and no bookable services. That is the exact
 * state behind "the schedule is full" on every call — and a front desk that knows no services can
 * book nothing, so it must not be the thing answering.
 */

// baseSettingsProps is a FACTORY, not a constant — it takes the overrides.
const props = (over: Partial<OrgSettingsProps> = {}): OrgSettingsProps => {
  const base = baseSettingsProps();
  return baseSettingsProps({
    serviceOriginAddress: "123 Main St, Pleasanton, CA 94566",
    booking: {
      ...base.booking,
      services: [{ name: "Drain clearing", price: 189, lane: "repair", triggers: "", ballpark: "" }],
    },
    ...over,
  });
};

describe("frontDeskReadiness", () => {
  it("is ready when hours, a service area and at least one service exist", () => {
    expect(frontDeskReadiness(props()).ready).toBe(true);
  });

  // A shop open zero hours every day is the "schedule is full" bug in its stored form.
  it("is not ready when every day is closed", () => {
    const closed = props({
      hoursMonOpen: 0, hoursMonClose: 0, hoursTueOpen: 0, hoursTueClose: 0,
      hoursWedOpen: 0, hoursWedClose: 0, hoursThuOpen: 0, hoursThuClose: 0,
      hoursFriOpen: 0, hoursFriClose: 0, hoursSatOpen: 0, hoursSatClose: 0,
      hoursSunOpen: 0, hoursSunClose: 0,
    });
    expect(frontDeskReadiness(closed).ready).toBe(false);
    expect(frontDeskReadiness(closed).missing).toContain("hours");
  });

  // Distance is measured from the origin address; without one there is nothing to measure from.
  it("is not ready without a service origin address", () => {
    const r = frontDeskReadiness(props({ serviceOriginAddress: null }));
    expect(r.ready).toBe(false);
    expect(r.missing).toContain("serviceArea");
  });

  it("treats a whitespace-only origin address as absent", () => {
    expect(frontDeskReadiness(props({ serviceOriginAddress: "   " })).missing).toContain("serviceArea");
  });

  // THE GUARD: an assistant that knows no services can book nothing.
  it("is not ready with an empty service list", () => {
    const r = frontDeskReadiness(props({
      booking: { ...baseSettingsProps().booking, services: [] },
    }));
    expect(r.ready).toBe(false);
    expect(r.missing).toContain("services");
  });

  it("reports every gap at once, so the checklist can show all of them", () => {
    const r = frontDeskReadiness(props({
      serviceOriginAddress: null,
      booking: { ...baseSettingsProps().booking, services: [] },
    }));
    expect(r.missing).toEqual(expect.arrayContaining(["serviceArea", "services"]));
  });

  it("counts a single open day as hours — a Saturday-only shop is a real shop", () => {
    const satOnly = props({
      hoursMonOpen: 0, hoursMonClose: 0, hoursTueOpen: 0, hoursTueClose: 0,
      hoursWedOpen: 0, hoursWedClose: 0, hoursThuOpen: 0, hoursThuClose: 0,
      hoursFriOpen: 0, hoursFriClose: 0, hoursSunOpen: 0, hoursSunClose: 0,
      hoursSatOpen: 8, hoursSatClose: 14,
    });
    expect(frontDeskReadiness(satOnly).missing).not.toContain("hours");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run modules/settings/domain/front-desk-readiness.test.ts`
Expected: FAIL — `Failed to resolve import "./front-desk-readiness"`.

- [ ] **Step 3: Write the predicate**

```ts
// modules/settings/domain/front-desk-readiness.ts
import type { OrgSettingsProps } from "./org-settings";

/**
 * Whether the AI front desk is configured well enough to answer a customer.
 *
 * front_desk defaulted to true, so a brand-new shop was given a phone number pointed at an
 * assistant that knew nobody's hours, no service area and no bookable services. Answering in that
 * state is worse than not answering: it is the shop's number, and the caller is a real customer.
 */

export type FrontDeskGap = "hours" | "serviceArea" | "services";

export interface FrontDeskReadiness {
  readonly ready: boolean;
  readonly missing: readonly FrontDeskGap[];
}

/** One day counts as open when its close hour is after its open hour. */
function hasAnyOpenDay(p: OrgSettingsProps): boolean {
  const days: readonly (readonly [number, number])[] = [
    [p.hoursMonOpen, p.hoursMonClose],
    [p.hoursTueOpen, p.hoursTueClose],
    [p.hoursWedOpen, p.hoursWedClose],
    [p.hoursThuOpen, p.hoursThuClose],
    [p.hoursFriOpen, p.hoursFriClose],
    [p.hoursSatOpen, p.hoursSatClose],
    [p.hoursSunOpen, p.hoursSunClose],
  ];
  return days.some(([open, close]) => close > open);
}

export function frontDeskReadiness(p: OrgSettingsProps): FrontDeskReadiness {
  const missing: FrontDeskGap[] = [];

  if (!hasAnyOpenDay(p)) missing.push("hours");
  // Distance is measured from the origin address, so without one there is nothing to measure from
  // and every caller is either in range or out of it by accident.
  if ((p.serviceOriginAddress ?? "").trim().length === 0) missing.push("serviceArea");
  // An assistant that knows no services can book nothing.
  if (p.booking.services.length === 0) missing.push("services");

  return { ready: missing.length === 0, missing };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run modules/settings/domain/front-desk-readiness.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Export it through the barrel**

Append to `modules/settings/index.ts`:

```ts
export { frontDeskReadiness, type FrontDeskGap, type FrontDeskReadiness } from "./domain/front-desk-readiness";
```

- [ ] **Step 6: Flip the column default**

First confirm no other branch owns a migration: `gh pr list` and check for `shared/db/migrations/`.

In `shared/db/schema/org-settings.ts`, change the `frontDesk` line to:

```ts
    // Defaults OFF. It used to default true, which handed every new shop a phone number pointed at
    // an assistant that knew nobody's hours, no service area and no services. It switches on when
    // frontDeskReadiness says it can — see modules/settings/domain/front-desk-readiness.ts.
    frontDesk: boolean("front_desk").notNull().default(false),
```

Generate the migration:

```bash
npm run db:generate
```

Open the generated SQL and confirm it contains ONLY an `ALTER COLUMN ... SET DEFAULT false`. **If it contains an `UPDATE`, delete that line** — existing orgs must keep their stored value. A shop already running its front desk must not have it switched off underneath them.

- [ ] **Step 7: Apply and verify**

```bash
npm run db:migrate
npm run db:verify
```

Expected: `db:verify ✓ all N migrations applied`.

Then confirm no live org was changed:

```bash
node --env-file=.env.local -e '
const postgres=require("postgres");const sql=postgres(process.env.DATABASE_URL,{max:1,ssl:"require",prepare:false});
sql`select front_desk, count(*) from org_settings group by front_desk`.then(r=>{console.log(r);return sql.end()});'
```

Expected: the existing distribution is unchanged — orgs that had `true` still have `true`.

- [ ] **Step 8: Commit**

```bash
git add shared/db/schema/org-settings.ts shared/db/migrations modules/settings/domain/front-desk-readiness.ts modules/settings/domain/front-desk-readiness.test.ts modules/settings/index.ts
git commit -m "feat: the front desk no longer answers by default

front_desk defaulted to true, so a new shop was handed a phone number pointed at
an assistant that knew nobody's hours, no service area and no bookable services
— the stored form of the 'schedule is full on every call' bug, and an AI
receptionist for shops that never asked for one.

New orgs only: the default changes, existing rows keep their stored value.

frontDeskReadiness is the pure predicate that decides when it may switch on; the
dashboard checklist consumes it."
```

---

### Task 6: Full gate and PR

- [ ] **Step 1: Run the whole gate**

```bash
npx tsc --noEmit
npm run lint
npm run lint:css
npm test
npm run test:int
npm run coverage
npm run build
```

Expected: tsc silent · lint 0 errors · lint:css 0 errors · all unit tests pass · all integration tests pass · coverage ≥ 80/75 · build compiles.

- [ ] **Step 2: Verify in the running app, not only in tests**

The previous round of this work shipped a bug that every test missed — a hydrator hard-coding a field to `""` — so a real run is required, not optional.

```bash
pnpm dev
```

Sign up a brand-new account with a Massachusetts ZIP (`02189`). Confirm:

1. The welcome screen says "Eastern time" before you submit.
2. After landing, Settings shows **Eastern time**, not Pacific.
3. `select timezone, front_desk from org_settings where org_id = '<new org>'` returns `America/New_York` and `false`.
4. `select callback_number from users where ...` returns the mobile you typed.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin feat/onboarding-foundation
gh pr create --title "Onboarding foundation: derive timezone, capture the mobile, silence the unconfigured front desk"
```

The body must state: what each of the three fixes changes for a NEW org, that the `front_desk` default change does not touch existing rows (with the query output proving it), and the settings screenshot diff.

---

## Notes for whoever picks this up

- **The `frontDesk` default is the one risky change.** Everything else is additive. Verify the existing distribution before and after.
- **Do not chase perfect ZIP geography.** The table is deliberately approximate and the Settings control is the answer to that. Adding a network geocode lookup would put a third-party dependency in the signup path.
- **The checklist is not in this plan.** Task 5 produces `frontDeskReadiness` specifically so the checklist plan has a tested predicate to build on.
