# Mallet Web App Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed, working web app at trymallet.com — email+password login, role-routed shells (owner/office → office app; tech → My Day only), office screens (Dashboard, Customers, Quotes, Jobs, Money, Assistant, Settings) and a mobile-first tech field view, all wired to the existing `trpc.v1` backend.

**Architecture:** Next.js App Router route groups `(auth)`/`(office)`/`(field)` with server-side role guards; client-side data via `@trpc/react-query` injecting the Supabase access token as a Bearer header (the existing backend auth path — zero server auth changes). Two small backend slices: `v1.identity` (signup via SECURITY DEFINER, me, members) and `v1.field` (myDay/start/complete with a tech assignee guard). Tailwind v4 tokens ported from the prototype; ~8 copy-in primitives.

**Tech Stack:** Next 16 (existing repo), Tailwind CSS v4 (`@tailwindcss/postcss`), `@supabase/ssr`, `@trpc/react-query` 11 + `@tanstack/react-query` 5 (both already installed), superjson (already installed), Vitest 4 (+ jsdom + @testing-library/react for component logic), Playwright.

**Spec:** `docs/superpowers/specs/2026-07-01-mallet-frontend-design.md`

## Global Constraints

- Every phase lands as its own PR **with the full gate green AND the adversarial review fixes committed BEFORE merge** (lesson from PR #7). Gate = `pnpm typecheck && pnpm lint && pnpm test && pnpm test:int && pnpm coverage && pnpm build`.
- **Role determines the view — no toggle.** `tech` → `(field)` only; `owner`/`office` → `(office)`. Role comes from the server-resolved Principal, never client state.
- **Mobile-first.** Field view designed phone-first; every office screen responsive (tables collapse to cards below `md`; sidebar becomes bottom tabs below `md`). Touch targets ≥ 44px (`min-h-11`).
- **No floating UI** — no popovers/portals/toasts; panels expand in-flow (`Sheet` renders as an in-flow section). Copy is functional, not chatty.
- **No react-native-web / NativeWind** in the web app. Theme = CSS custom properties; primitives are copy-in, RN-Reusables-compatible naming; data logic in `features/*/hooks.ts` separated from presentation.
- Money is integer cents end-to-end; render only via `formatMoney`. DTO money objects are `{ cents, currency }`.
- `orgId` is NEVER client input — it comes from the verified Principal server-side (existing invariant).
- Frontend files: components < ~120 lines, one responsibility each; `max-lines-per-function` 80 (warn) applies — keep page components composed of small pieces.
- New backend code follows the existing 5-layer slice pattern, TDD, and the repo's migration conventions (drizzle generate for tables; hand-written numbered SQL + `_journal.json` entry for functions/RLS; `pnpm db:migrate` then `pnpm db:setup-role` after any new object).
- Secrets stay in `.env.local` (gitignored). The pasted-in-chat credential set must be ROTATED before production cutover (Task 21).

## Shared naming conventions (used across all tasks)

- `api` — the tRPC React client: `import { api } from "@/lib/trpc/client"`.
- Hooks live in `features/<domain>/hooks.ts` and are the ONLY place components touch `api`.
- Primitives: `import { Button } from "@/components/ui/button"` etc. (lowercase filenames).
- `formatMoney(cents: number): string`, `formatDate(iso: string | null): string`, `formatDateTime(iso: string | null): string` from `@/lib/format`.
- `userMessage(error: unknown): string` from `@/lib/trpc/error-map`.
- Theme classes come from `@theme` tokens: `bg-bg`, `bg-card`, `bg-paper`, `border-line`, `text-ink`, `text-ink-muted`, `bg-accent`, `text-accent-fg`, tone pairs `text-amber`/`bg-amber-bg`, `text-red`/`bg-red-bg`, `text-blue`/`bg-blue-bg`, `text-green`/`bg-green-bg`, radii `rounded-card`/`rounded-control`.

---

# Phase A — Foundation (branch `feat/frontend-foundation`, PR: "feat(web): foundation — theme, primitives, auth, identity slice, role-routed shells")

Create the branch off up-to-date main: `git checkout main && git pull && git checkout -b feat/frontend-foundation`. First commit on the branch: the spec + this plan (`git add docs/superpowers && git commit -m "docs: frontend spec + implementation plan"`).

### Task 1: Tailwind v4 + Mallet theme tokens + fonts

**Files:**
- Create: `postcss.config.mjs`
- Create: `app/globals.css`
- Modify: `app/layout.tsx`
- Modify: `package.json` (deps)

**Interfaces:**
- Produces: theme utility classes (`bg-bg`, `text-ink`, `border-line`, `rounded-card`, `rounded-control`, tone pairs — see conventions) and CSS vars consumed by every later UI task; `font-display` / body font wired via `next/font`.

- [ ] **Step 1: Install Tailwind v4**

```bash
pnpm add tailwindcss @tailwindcss/postcss
```

- [ ] **Step 2: Create `postcss.config.mjs`**

```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

- [ ] **Step 3: Create `app/globals.css`** (palette ported from the prototype's `:root`; green pair added for paid/complete tones — the prototype had none)

```css
@import "tailwindcss";

@theme {
  /* Surfaces & ink — ported from elas-crm-prototype.html */
  --color-bg: #fcfbf7;
  --color-card: #fefefc;
  --color-paper: #f1ede4;
  --color-line: #eae4d7;
  --color-ink: #15110b;
  --color-ink-muted: #6b6455;
  --color-accent: #1a1510;
  --color-accent-fg: #ffffff;
  --color-manila: #f7f0e1;
  --color-manila-line: #e3d8c1;

  /* Tones (text on bg pairs) */
  --color-amber: #9a6700;
  --color-amber-bg: #f2ead9;
  --color-red: #b23a2a;
  --color-red-bg: #f4e7e1;
  --color-blue: #4a639e;
  --color-blue-bg: #e9ecf3;
  --color-green: #3d7a4e;
  --color-green-bg: #e6efe3;

  /* Shape */
  --radius-card: 12px;
  --radius-control: 9px;

  /* Type — variables provided by next/font in layout.tsx */
  --font-display: var(--font-space-grotesk);
  --font-body: var(--font-inter);
}

body {
  background: var(--color-bg);
  color: var(--color-ink);
  font-family: var(--font-body);
}
```

- [ ] **Step 4: Rewrite `app/layout.tsx`** (fonts + globals; the tRPC provider is added in Task 6)

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });

export const metadata: Metadata = {
  title: "Mallet",
  description: "AI-native operating system for service businesses.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 5: Verify the build compiles the theme**

Run: `pnpm build`
Expected: `✓ Compiled successfully`, route `/` renders (placeholder content is restyled by body rules).

- [ ] **Step 6: Commit**

```bash
git add postcss.config.mjs app/globals.css app/layout.tsx package.json pnpm-lock.yaml
git commit -m "feat(web): Tailwind v4 + Mallet theme tokens + fonts"
```

### Task 2: UI primitives (copy-in kit) + component test setup

**Files:**
- Create: `components/ui/button.tsx`, `components/ui/card.tsx`, `components/ui/input.tsx`, `components/ui/badge.tsx`, `components/ui/sheet.tsx`, `components/ui/empty-state.tsx`, `components/ui/data-table.tsx`, `components/ui/page-header.tsx`
- Create: `components/ui/data-table.test.tsx`, `components/ui/sheet.test.tsx`
- Modify: `package.json` (dev deps), `vitest.config.ts` (include `.test.tsx` already covered by `**/*.test.tsx`)

**Interfaces:**
- Produces (exact props consumed by every screen task):
  - `Button({ variant?: "primary" | "quiet" | "danger", ...ButtonHTMLAttributes })`
  - `Card({ children, className? })`
  - `Field({ label, children })`, `Input(InputHTMLAttributes)`, `Select(SelectHTMLAttributes)`
  - `Badge({ tone: "neutral" | "amber" | "red" | "blue" | "green", children })`
  - `Sheet({ open: boolean, title: string, onClose: () => void, children })` — in-flow section, NOT a portal
  - `EmptyState({ title, hint?, action? })`
  - `DataTable<T>({ columns: Column<T>[], rows: T[], rowKey: (r: T) => string, onRowClick?: (r: T) => void, empty: ReactNode })` with `type Column<T> = { key: string; header: string; render: (r: T) => ReactNode; hideOnMobile?: boolean }` — table on `md+`, stacked cards below
  - `PageHeader({ title, action? })`

- [ ] **Step 1: Install component-test deps**

```bash
pnpm add -D jsdom @testing-library/react @testing-library/user-event
```

- [ ] **Step 2: Write the failing tests** (`components/ui/data-table.test.tsx`)

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataTable } from "./data-table";

const rows = [
  { id: "1", name: "Karen", due: "$120.00" },
  { id: "2", name: "Bob", due: "$0.00" },
];
const columns = [
  { key: "name", header: "Name", render: (r: (typeof rows)[0]) => r.name },
  { key: "due", header: "Due", render: (r: (typeof rows)[0]) => r.due, hideOnMobile: true },
];

describe("DataTable", () => {
  it("renders BOTH a desktop table and mobile cards for the same rows (CSS chooses)", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty="none" />);
    // Table region (hidden below md via classes) + card region both exist in the DOM.
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getAllByText("Karen").length).toBe(2); // once in table, once in card list
  });

  it("renders the empty state when there are no rows", () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r: { id: string }) => r.id} empty="Nothing yet" />);
    expect(screen.getByText("Nothing yet")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
```

And `components/ui/sheet.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sheet } from "./sheet";

describe("Sheet", () => {
  it("renders nothing when closed and an in-flow section (no dialog/portal) when open", () => {
    const { rerender, container } = render(
      <Sheet open={false} title="New customer" onClose={() => {}}>x</Sheet>,
    );
    expect(container.innerHTML).toBe("");
    rerender(<Sheet open title="New customer" onClose={() => {}}>x</Sheet>);
    expect(screen.getByText("New customer")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull(); // in-flow, not a floating dialog
  });

  it("calls onClose from the Close button", async () => {
    const onClose = vi.fn();
    render(<Sheet open title="t" onClose={onClose}>x</Sheet>);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test components/ui`
Expected: FAIL — modules `./data-table` / `./sheet` not found.

- [ ] **Step 4: Implement the primitives**

`components/ui/button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from "react";

const variants = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  quiet: "border border-line bg-transparent text-ink hover:bg-paper",
  danger: "bg-red-bg text-red hover:opacity-90",
} as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants };

export function Button({ variant = "primary", className = "", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-sm font-medium transition disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
```

`components/ui/card.tsx`:

```tsx
import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-card border border-line bg-card p-4 ${className}`}>{children}</div>;
}
```

`components/ui/input.tsx`:

```tsx
import type { InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from "react";

const controlClass =
  "min-h-11 w-full rounded-control border border-line bg-card px-3 text-sm text-ink outline-none focus:border-ink";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${controlClass} ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${controlClass} ${className}`} {...props} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-muted">{label}</span>
      {children}
    </label>
  );
}
```

`components/ui/badge.tsx`:

```tsx
import type { ReactNode } from "react";

const tones = {
  neutral: "bg-paper text-ink",
  amber: "bg-amber-bg text-amber",
  red: "bg-red-bg text-red",
  blue: "bg-blue-bg text-blue",
  green: "bg-green-bg text-green",
} as const;

export type BadgeTone = keyof typeof tones;

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`inline-flex rounded-control px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
```

`components/ui/sheet.tsx` (in-flow — the no-floating-UI rule):

```tsx
import type { ReactNode } from "react";
import { Button } from "./button";

export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <section className="mt-4 rounded-card border border-line bg-card p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-base font-semibold">{title}</h2>
        <Button variant="quiet" onClick={onClose}>Close</Button>
      </header>
      {children}
    </section>
  );
}
```

`components/ui/empty-state.tsx`:

```tsx
import type { ReactNode } from "react";

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line bg-paper p-8 text-center">
      <p className="font-medium text-ink">{title}</p>
      {hint ? <p className="mt-1 text-sm text-ink-muted">{hint}</p> : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}
```

`components/ui/data-table.tsx` (renders BOTH layouts; CSS shows one):

```tsx
import type { ReactNode } from "react";

export type Column<T> = { key: string; header: string; render: (row: T) => ReactNode; hideOnMobile?: boolean };

export function DataTable<T>({ columns, rows, rowKey, onRowClick, empty }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty: ReactNode;
}) {
  if (rows.length === 0) return <>{empty}</>;
  const clickable = onRowClick ? "cursor-pointer hover:bg-paper" : "";
  return (
    <div>
      <table className="hidden w-full border-collapse md:table">
        <thead>
          <tr className="border-b border-line text-left">
            {columns.map((c) => (
              <th key={c.key} className="px-3 py-2 text-xs font-medium text-ink-muted">{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={`border-b border-line ${clickable}`} onClick={() => onRowClick?.(row)}>
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-3 text-sm">{c.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="space-y-2 md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className={`rounded-card border border-line bg-card p-3 ${clickable}`} onClick={() => onRowClick?.(row)}>
            {columns.filter((c) => !c.hideOnMobile).map((c) => (
              <div key={c.key} className="flex items-center justify-between py-0.5 text-sm">
                <span className="text-xs text-ink-muted">{c.header}</span>
                <span>{c.render(row)}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

`components/ui/page-header.tsx`:

```tsx
import type { ReactNode } from "react";

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header className="mb-4 flex items-center justify-between">
      <h1 className="font-display text-xl font-semibold">{title}</h1>
      {action ?? null}
    </header>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test components/ui`
Expected: PASS (4 tests).

- [ ] **Step 6: Full unit suite + commit**

```bash
pnpm test
git add components/ package.json pnpm-lock.yaml
git commit -m "feat(web): copy-in UI primitive kit (Mallet theme) + component tests"
```

### Task 3: Identity backend — token verifier email/org-hint, signup SECURITY DEFINER, context + procedures

**Files:**
- Modify: `modules/identity/domain/auth-provider.ts` (TokenVerifier return type)
- Modify: `modules/identity/infra/supabase-token-verifier.ts`
- Modify: `modules/identity/infra/supabase-auth-provider.test.ts` (fakes gain the new fields)
- Create: `shared/db/migrations/0022_signup_fn.sql` + entry in `shared/db/migrations/meta/_journal.json`
- Create: `modules/identity/infra/signup-store.ts`
- Modify: `modules/identity/index.ts` (export `createSupabaseTokenVerifier`, `SignupStore`, new types)
- Modify: `trpc/deps.ts` (add `tokenVerifier`, `signupStore`), `trpc/di.ts` (wire both)
- Modify: `trpc/init.ts` (Context gains `unmapped`; add `authedNoPrincipal` + `anyRole` procedures)
- Modify: `trpc/context.ts` (populate `unmapped` when token verifies but no principal resolves)
- Modify (mechanical): every capstone int test's ctx `deps` literal gains `tokenVerifier: { verify: async () => null }, signupStore: { createOrgForUser: async () => { throw new Error("unused"); } }` (same pattern as prior AppDeps additions)

**Interfaces:**
- Produces:
  - `TokenVerifier.verify(token): Promise<{ authUserId: string; email: string; orgNameHint: string | null } | null>`
  - `Context.unmapped: { authUserId: string; email: string; orgNameHint: string | null } | null`
  - `authedNoPrincipal` procedure — passes when `ctx.principal` OR `ctx.unmapped` is set; context type narrows to `{ principal, unmapped }` as-is
  - `anyRole` procedure — requireAuth + requireRole(["owner","office","tech"]) + orgTx (same shape as `ownerOrOffice`)
  - `SignupStore.createOrgForUser(input: { authUserId: string; email: string; orgName: string }): Promise<{ orgId: string; role: string }>`
  - SQL fn `app_signup_create_org(p_auth_user_id uuid, p_email text, p_org_name text) returns table (org_id uuid, role text)`

- [ ] **Step 1: Write the failing unit test update** — in `modules/identity/infra/supabase-auth-provider.test.ts`, update the fake verifier(s) from `verify: async () => ({ authUserId: "..." })` to `verify: async () => ({ authUserId: "...", email: "o@x.com", orgNameHint: null })` and add one assertion that the provider still resolves a principal with the extended shape. Run `pnpm test modules/identity` — Expected: FAIL (type error) until Step 2.

- [ ] **Step 2: Extend the verifier**

`modules/identity/domain/auth-provider.ts` — replace the `TokenVerifier` interface:

```ts
// Verifies a token's signature/expiry and extracts the auth identity plus signup hints.
export interface VerifiedToken {
  readonly authUserId: string;
  readonly email: string;
  readonly orgNameHint: string | null; // user_metadata.org_name captured at auth signUp
}

export interface TokenVerifier {
  verify(accessToken: string): Promise<VerifiedToken | null>;
}
```

`modules/identity/infra/supabase-token-verifier.ts` — return the new fields:

```ts
return {
  authUserId: data.user.id,
  email: data.user.email ?? "",
  orgNameHint: typeof data.user.user_metadata?.org_name === "string" ? data.user.user_metadata.org_name : null,
};
```

Run: `pnpm test modules/identity` — Expected: PASS.

- [ ] **Step 3: Migration 0022 — the signup seam** (`shared/db/migrations/0022_signup_fn.sql`)

```sql
-- Signup provisioning seam (mirrors app_resolve_principal / app_resolve_api_key): a NEW user has a
-- verified Supabase identity but no org, so provisioning cannot run under withTenant. Rather than a
-- BYPASSRLS connection, one narrow SECURITY DEFINER function creates org + owner mapping atomically.
-- Idempotent: an already-provisioned auth user gets their existing org back (safe to call on every
-- login). Concurrent duplicate signups collapse via the users_auth_user_uidx unique index.
CREATE OR REPLACE FUNCTION public.app_signup_create_org(p_auth_user_id uuid, p_email text, p_org_name text)
  RETURNS TABLE (org_id uuid, role text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT u.org_id, u.role INTO org_id, role FROM public.users u WHERE u.auth_user_id = p_auth_user_id;
  IF FOUND THEN RETURN NEXT; RETURN; END IF;

  BEGIN
    INSERT INTO public.orgs (name) VALUES (p_org_name) RETURNING id INTO v_org;
    INSERT INTO public.users (org_id, auth_user_id, email, role) VALUES (v_org, p_auth_user_id, p_email, 'owner');
    org_id := v_org; role := 'owner';
    RETURN NEXT;
  EXCEPTION WHEN unique_violation THEN
    -- Lost a concurrent race: the other tx provisioned this auth user. Return theirs.
    SELECT u.org_id, u.role INTO org_id, role FROM public.users u WHERE u.auth_user_id = p_auth_user_id;
    RETURN NEXT;
  END;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_signup_create_org(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mallet_app') THEN
    GRANT EXECUTE ON FUNCTION public.app_signup_create_org(uuid, text, text) TO mallet_app;
  END IF;
END $$;
```

Append to `shared/db/migrations/meta/_journal.json` `entries` (idx 22, version "7", `when` = current epoch ms, tag `0022_signup_fn`, breakpoints true — same shape as 0020's entry).

- [ ] **Step 4: Apply + re-grant**

```bash
pnpm db:migrate && pnpm db:setup-role
```
Expected: `migrations applied successfully!` and `mallet_app ready ✓`.

- [ ] **Step 5: SignupStore** (`modules/identity/infra/signup-store.ts`)

```ts
import { sql } from "drizzle-orm";
import type { Database } from "@mallet/shared/db/client";

export interface SignupInput {
  readonly authUserId: string;
  readonly email: string;
  readonly orgName: string;
}

export interface ProvisionedOrg {
  readonly orgId: string;
  readonly role: string;
}

// The signup provisioning port: resolves/creates the org for a verified-but-unmapped auth user via
// the SECURITY DEFINER app_signup_create_org (idempotent) on the least-privilege connection.
export class SignupStore {
  constructor(private readonly db: Database) {}

  async createOrgForUser(input: SignupInput): Promise<ProvisionedOrg> {
    const rows = (await this.db.execute(
      sql`select org_id, role from public.app_signup_create_org(${input.authUserId}, ${input.email}, ${input.orgName})`,
    )) as unknown as { org_id: string; role: string }[];
    const row = rows[0];
    if (!row) throw new Error("app_signup_create_org returned no row");
    return { orgId: row.org_id, role: row.role };
  }
}
```

Export from `modules/identity/index.ts`:

```ts
export { createSupabaseTokenVerifier } from "./infra/supabase-token-verifier";
export { SignupStore } from "./infra/signup-store";
export type { SignupInput, ProvisionedOrg } from "./infra/signup-store";
export type { VerifiedToken } from "./domain/auth-provider";
```

- [ ] **Step 6: AppDeps + DI.** In `trpc/deps.ts` add to `AppDeps`:

```ts
// Signup-time collaborators: verify a token WITHOUT requiring an existing principal, and provision
// an org for a verified-but-unmapped auth user (SECURITY DEFINER seam).
readonly tokenVerifier: TokenVerifier;
readonly signupStore: Pick<SignupStore, "createOrgForUser">;
```

(import `TokenVerifier`, `SignupStore` types from `@mallet/identity`). In `trpc/di.ts`:

```ts
tokenVerifier: createSupabaseTokenVerifier(config.NEXT_PUBLIC_SUPABASE_URL, config.NEXT_PUBLIC_SUPABASE_ANON_KEY),
signupStore: new SignupStore(db),
```

- [ ] **Step 7: Context + procedures.** `trpc/init.ts` — extend `Context` and add the two procedures:

```ts
export interface Context {
  readonly principal: Principal | null;
  // Verified Supabase identity that has NO users-row yet (signup-in-progress). Set only when the
  // token verifies but principal resolution fails; consumed exclusively by identity.signup.
  readonly unmapped: VerifiedToken | null;
  readonly tx: TenantTx | null;
  readonly deps: AppDeps;
}
```

```ts
// Authenticated Supabase identity, provisioned OR NOT — the signup entry point. Everything else
// requires a full principal.
const requireVerifiedIdentity = t.middleware(({ ctx, next }) => {
  if (!ctx.principal && !ctx.unmapped) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "authentication required" });
  }
  return next();
});
export const authedNoPrincipal = publicProcedure.use(requireVerifiedIdentity);

// Any org member (owner/office/tech), inside their org transaction — for surfaces every role uses
// (identity.me, the field view).
export const anyRole = publicProcedure.use(requireAuth).use(requireRole(["owner", "office", "tech"])).use(orgTx);
```

`trpc/context.ts` — populate `unmapped` (and add it to the return):

```ts
let principal: Context["principal"] = null;
let unmapped: Context["unmapped"] = null;
if (token) {
  const result = await opts.deps.authProvider.authenticate(token);
  if (result.ok) {
    principal = result.value;
  } else {
    // Not provisioned yet (or invalid). A VALID token still identifies the auth user for signup.
    unmapped = await opts.deps.tokenVerifier.verify(token);
  }
}
return { principal, unmapped, tx: null, deps: opts.deps };
```

- [ ] **Step 8: Mechanical ctx updates.** Two changes to every existing capstone int test (grep `authProvider: stubAuth` across `modules/**/*.int.test.ts` — same files updated for prior AppDeps additions):
  1. Add the two new deps to each `deps` literal: `tokenVerifier: { verify: async () => null }, signupStore: { createOrgForUser: async () => { throw new Error("unused in this test"); } },`
  2. Add `unmapped: null,` to each `Context` object literal (the `Context` interface gained a required field — typecheck will point at every site).

- [ ] **Step 9: Gate the slice**

Run: `pnpm typecheck && pnpm test`
Expected: clean; all existing suites still pass.

- [ ] **Step 10: Commit**

```bash
git add modules/identity shared/db/migrations trpc/ modules/**/*.int.test.ts
git commit -m "feat(identity): signup provisioning seam — verifier email/org-hint, app_signup_create_org, authedNoPrincipal + anyRole"
```

### Task 4: `v1.identity` router — signup / me / members (+ int tests)

**Files:**
- Create: `modules/identity/api/identity-router.ts`
- Create: `modules/identity/api/identity.int.test.ts`
- Modify: `modules/identity/index.ts` (export `createIdentityRouter`)
- Modify: `trpc/root.ts` (mount `identity: createIdentityRouter()`)

**Interfaces:**
- Consumes: `authedNoPrincipal`, `anyRole`, `ownerOrOffice` from `@/trpc/init`; `SignupStore` port + `withTenant`; `orgs`/`users` tables from `@mallet/shared/db/schema`.
- Produces (consumed by every frontend task):
  - `v1.identity.signup` — mutation, input `{ orgName?: string }`, output `meDTO`
  - `v1.identity.me` — query, output `meDTO = { role: "owner"|"office"|"tech", orgId: string, orgName: string, email: string }`
  - `v1.identity.members` — query, output `{ items: { id: string; email: string; role: "owner"|"office"|"tech" }[] }`

- [ ] **Step 1: Write the failing int test** (`modules/identity/api/identity.int.test.ts`) — follows the repo's capstone pattern (createCaller + live RLS; see `modules/ai/api/ai-router.int.test.ts` for the ctx recipe):

```ts
import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb, db } from "@mallet/shared/db/client";
import { SignupStore } from "@mallet/identity";
import type { Principal, Role, VerifiedToken } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
const createdOrgIds: string[] = [];

const stubDeps = {
  authProvider: { authenticate: async () => { throw new Error("unused"); } },
  apiKeyAuthenticator: { authenticate: async () => null },
  tokenVerifier: { verify: async () => null },
  signupStore: new SignupStore(db),
  bus: new InMemoryEventBus(),
  clock: systemClock,
  ids: uuidGenerator,
  paymentLinkGateway: null,
  llmClient: null,
} as unknown as Context["deps"];

const unmappedCtx = (unmapped: VerifiedToken): Context => ({ principal: null, unmapped, tx: null, deps: stubDeps });
const principalCtx = (orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: stubDeps,
});

suite("v1.identity (live RLS)", () => {
  afterAll(async () => {
    for (const id of createdOrgIds) await admin`delete from orgs where id = ${id}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("signup provisions org+owner for an unmapped identity, idempotently", async () => {
    const authUserId = randomUUID();
    const caller = appRouter.createCaller(unmappedCtx({ authUserId, email: "own@e2e.test", orgNameHint: "Duggan Electric" }));

    const first = await caller.v1.identity.signup({});
    createdOrgIds.push(first.orgId);
    expect(first.role).toBe("owner");
    expect(first.orgName).toBe("Duggan Electric");

    const again = await caller.v1.identity.signup({ orgName: "Renamed LLC" }); // idempotent — no second org
    expect(again.orgId).toBe(first.orgId);

    const users = await admin`select role, email from users where auth_user_id = ${authUserId}`;
    expect(users).toHaveLength(1);
  });

  it("me returns role + org name for a provisioned member (any role incl. tech)", async () => {
    const [org] = await admin<{ id: string }[]>`insert into orgs (name) values ('Me Org') returning id`;
    createdOrgIds.push(org!.id);
    const authUserId = randomUUID();
    const [u] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${authUserId}, 't@x.com', 'tech') returning id`;
    const ctx: Context = { ...principalCtx(org!.id, "tech"), principal: { userId: asUserId(u!.id), orgId: asOrgId(org!.id), role: "tech" } };

    const me = await appRouter.createCaller(ctx).v1.identity.me();
    expect(me).toMatchObject({ role: "tech", orgName: "Me Org" });
  });

  it("members lists the org's users for owner/office and FORBIDDEN for tech", async () => {
    const [org] = await admin<{ id: string }[]>`insert into orgs (name) values ('Members Org') returning id`;
    createdOrgIds.push(org!.id);
    await admin`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${randomUUID()}, 'o@x.com', 'owner'), (${org!.id}, ${randomUUID()}, 'te@x.com', 'tech')`;

    const list = await appRouter.createCaller(principalCtx(org!.id, "owner")).v1.identity.members();
    expect(list.items.map((m) => m.role).sort()).toEqual(["owner", "tech"]);

    await expect(appRouter.createCaller(principalCtx(org!.id, "tech")).v1.identity.members()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:int modules/identity`
Expected: FAIL — `v1.identity` not on the router.

- [ ] **Step 3: Implement the router** (`modules/identity/api/identity-router.ts`)

```ts
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { orgs, users } from "@mallet/shared/db/schema";
import { withTenant } from "@mallet/shared/db/tx";
import { asOrgId } from "@mallet/shared/types";
import { router, authedNoPrincipal, anyRole, ownerOrOffice } from "@/trpc/init";
import { ROLES } from "../domain/principal";

const roleEnum = z.enum(ROLES as unknown as ["owner", "office", "tech"]);
const meDTO = z.object({ role: roleEnum, orgId: z.string().uuid(), orgName: z.string(), email: z.string() });

const orgNameOf = async (orgId: string): Promise<string> =>
  withTenant(asOrgId(orgId), async (tx) => {
    const [row] = await tx.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, orgId));
    return row?.name ?? "";
  });

export const createIdentityRouter = () =>
  router({
    // Idempotent provisioning: called once after any login. An unmapped (new) identity gets an org
    // created via the SECURITY DEFINER seam; an already-provisioned one gets its org back.
    signup: authedNoPrincipal
      .input(z.object({ orgName: z.string().min(1).max(80).optional() }))
      .output(meDTO)
      .mutation(async ({ ctx, input }) => {
        if (ctx.principal) {
          const email = ctx.unmapped?.email ?? "";
          return { role: ctx.principal.role, orgId: ctx.principal.orgId, orgName: await orgNameOf(ctx.principal.orgId), email };
        }
        const unmapped = ctx.unmapped;
        if (!unmapped) throw new TRPCError({ code: "UNAUTHORIZED", message: "authentication required" });
        const orgName = input.orgName ?? unmapped.orgNameHint ?? "My business";
        const provisioned = await ctx.deps.signupStore.createOrgForUser({
          authUserId: unmapped.authUserId,
          email: unmapped.email,
          orgName,
        });
        const role = roleEnum.parse(provisioned.role);
        return { role, orgId: provisioned.orgId, orgName: await orgNameOf(provisioned.orgId), email: unmapped.email };
      }),

    // Who am I + which org — what the shell routes on. Any role.
    me: anyRole.output(meDTO).query(async ({ ctx }) => {
      const [org] = await ctx.tx.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, ctx.principal.orgId));
      const [self] = await ctx.tx.select({ email: users.email }).from(users).where(eq(users.id, ctx.principal.userId));
      return { role: ctx.principal.role, orgId: ctx.principal.orgId, orgName: org?.name ?? "", email: self?.email ?? "" };
    }),

    // The org's people — feeds the Jobs assign picker. Office-side only.
    members: ownerOrOffice
      .output(z.object({ items: z.array(z.object({ id: z.string().uuid(), email: z.string(), role: roleEnum })) }))
      .query(async ({ ctx }) => {
        const rows = await ctx.tx.select({ id: users.id, email: users.email, role: users.role }).from(users);
        return { items: rows.map((r) => ({ id: r.id, email: r.email, role: roleEnum.parse(r.role) })) };
      }),
  });
```

Export from `modules/identity/index.ts`: `export { createIdentityRouter } from "./api/identity-router";`
Mount in `trpc/root.ts`: `identity: createIdentityRouter(),` (import from `@mallet/identity`).

Note: `me` uses `principal.userId` = the users-row id (that's what `DbPrincipalResolver` resolves) — but the int test builds a random `userId` for `members`; only the `me` test needs the real users-row id (it uses it). The `signup` idempotency path returns email from `ctx.unmapped` which is null for a provisioned principal → email falls back to `""`; the frontend uses `me` for display, which reads the users row. Acceptable.

- [ ] **Step 4: Run int tests**

Run: `pnpm test:int modules/identity`
Expected: PASS (3 tests).

- [ ] **Step 5: Full gate + commit**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:int && pnpm build
git add modules/identity trpc/root.ts
git commit -m "feat(identity): v1.identity router — signup/me/members"
```

### Task 5: Supabase browser/server clients + session middleware + email-link confirm route

**Files:**
- Create: `lib/supabase/browser.ts`, `lib/supabase/server.ts`
- Create: `middleware.ts` (repo root)
- Create: `app/auth/confirm/route.ts`
- Modify: `package.json` (add `@supabase/ssr` — `@supabase/supabase-js` already present)

**Interfaces:**
- Produces: `createSupabaseBrowser(): SupabaseClient` (client components), `createSupabaseServer(): Promise<SupabaseClient>` (server components/route handlers), session cookies auto-refreshed by middleware; email confirmation + recovery links land on `/auth/confirm`.

- [ ] **Step 1: Install**

```bash
pnpm add @supabase/ssr
```

- [ ] **Step 2: `lib/supabase/browser.ts`**

```ts
import { createBrowserClient } from "@supabase/ssr";

// Browser Supabase client (cookie-backed session shared with the server helpers).
export const createSupabaseBrowser = () =>
  createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
```

- [ ] **Step 3: `lib/supabase/server.ts`**

```ts
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// Server-side Supabase client for server components / route handlers. setAll is a no-op failure in
// server components (cookies are read-only there) — middleware owns the refresh writes.
export const createSupabaseServer = async () => {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component render — middleware refreshes sessions instead.
        }
      },
    },
  });
};
```

- [ ] **Step 4: `middleware.ts`** (root — session refresh so server guards always see a live session)

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await supabase.auth.getUser(); // refreshes an expired session into the cookies
  return response;
}

// Everything except static assets and the API routes that carry their own auth (tRPC Bearer, MCP,
// webhooks, cron).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|mcp).*)"],
};
```

- [ ] **Step 5: `app/auth/confirm/route.ts`** (email confirmation + password-recovery links)

```ts
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabase/server";

// Supabase email links (signup confirmation, password recovery) land here with a token_hash.
// Verify server-side, then send the user to the right screen.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  if (!tokenHash || !type) return redirectTo("/login?error=invalid_link");

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) return redirectTo("/login?error=expired_link");

  return redirectTo(type === "recovery" ? "/reset-password" : "/");
}
```

- [ ] **Step 6: Verify + commit**

Run: `pnpm typecheck && pnpm build` — Expected: clean; `/auth/confirm` appears in the route list.

```bash
git add lib/supabase middleware.ts app/auth package.json pnpm-lock.yaml
git commit -m "feat(web): supabase ssr clients, session middleware, email-link confirm route"
```

### Task 6: tRPC React client + provider + error map + identity hooks

**Files:**
- Create: `lib/trpc/client.ts`, `lib/trpc/provider.tsx`, `lib/trpc/error-map.ts`, `lib/trpc/error-map.test.ts`
- Create: `features/identity/hooks.ts`
- Modify: `app/layout.tsx` (wrap children in `TrpcProvider`)

**Interfaces:**
- Consumes: `AppRouter` type from `@/trpc/root` (type-only import — erased at build), `createSupabaseBrowser`.
- Produces: `api` (typed tRPC React client), `TrpcProvider`, `userMessage(error: unknown): string`, `useMe()`, `useEnsureProvisioned()`, `useMembers()`.

- [ ] **Step 1: Write the failing error-map test** (`lib/trpc/error-map.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { userMessage } from "./error-map";

const trpcError = (code: string) => ({ data: { code }, message: "raw server text" });

describe("userMessage", () => {
  it("maps known TRPC codes to friendly copy and never echoes raw text for unknowns", () => {
    expect(userMessage(trpcError("UNAUTHORIZED"))).toBe("Your session expired. Sign in again.");
    expect(userMessage(trpcError("FORBIDDEN"))).toBe("Your role can't do that.");
    expect(userMessage(trpcError("PRECONDITION_FAILED"))).toBe("That feature isn't set up yet for this account.");
    expect(userMessage(trpcError("TOO_MANY_REQUESTS"))).toBe("The assistant is busy. Try again in a moment.");
    expect(userMessage(trpcError("INTERNAL_SERVER_ERROR"))).toBe("Something went wrong. Try again.");
    expect(userMessage(new Error("connection refused"))).toBe("Something went wrong. Try again.");
  });

  it("passes through BAD_REQUEST / NOT_FOUND / CONFLICT server messages (they are written for users)", () => {
    expect(userMessage(trpcError("BAD_REQUEST"))).toBe("raw server text");
    expect(userMessage(trpcError("NOT_FOUND"))).toBe("raw server text");
    expect(userMessage(trpcError("CONFLICT"))).toBe("raw server text");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm test lib/trpc` → FAIL (module not found).

- [ ] **Step 3: Implement**

`lib/trpc/error-map.ts`:

```ts
// One seam turning transport errors into user-facing copy. Validation/not-found/conflict messages
// are authored server-side for users and pass through; everything else maps to fixed copy so raw
// provider/DB text never reaches the UI.
const FIXED: Record<string, string> = {
  UNAUTHORIZED: "Your session expired. Sign in again.",
  FORBIDDEN: "Your role can't do that.",
  PRECONDITION_FAILED: "That feature isn't set up yet for this account.",
  TOO_MANY_REQUESTS: "The assistant is busy. Try again in a moment.",
  BAD_GATEWAY: "The assistant is unavailable right now. Try again shortly.",
};
const PASS_THROUGH = new Set(["BAD_REQUEST", "NOT_FOUND", "CONFLICT"]);
const FALLBACK = "Something went wrong. Try again.";

export const userMessage = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = (error as { data?: { code?: string } }).data;
    const code = data?.code ?? "";
    if (FIXED[code]) return FIXED[code];
    if (PASS_THROUGH.has(code) && "message" in error) return String((error as { message: unknown }).message);
  }
  return FALLBACK;
};
```

`lib/trpc/client.ts`:

```ts
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@/trpc/root";

export const api = createTRPCReact<AppRouter>();
```

`lib/trpc/provider.tsx`:

```tsx
"use client";
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/react-query";
import superjson from "superjson";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { api } from "./client";

// App-wide tRPC + React Query provider. The Bearer token is read PER REQUEST from the live
// Supabase session (never cached) so refreshes propagate.
export function TrpcProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }));
  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
          headers: async () => {
            const { data } = await createSupabaseBrowser().auth.getSession();
            const token = data.session?.access_token;
            return token ? { authorization: `Bearer ${token}` } : {};
          },
        }),
      ],
    }),
  );
  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </api.Provider>
  );
}
```

`features/identity/hooks.ts`:

```ts
"use client";
import { api } from "@/lib/trpc/client";

export const useMe = () => api.v1.identity.me.useQuery(undefined, { staleTime: 5 * 60_000, retry: false });
export const useMembers = () => api.v1.identity.members.useQuery();
// Idempotent org provisioning — called once after login by the welcome screen.
export const useEnsureProvisioned = () => api.v1.identity.signup.useMutation();
```

Wrap the app in `app/layout.tsx`: `import { TrpcProvider } from "@/lib/trpc/provider";` and change the body to `<body><TrpcProvider>{children}</TrpcProvider></body>`.

- [ ] **Step 4: Run tests + build**

Run: `pnpm test lib/trpc && pnpm build`
Expected: PASS + clean build.

- [ ] **Step 5: Commit**

```bash
git add lib/trpc features/identity app/layout.tsx
git commit -m "feat(web): trpc react client + provider, error map, identity hooks"
```

### Task 7: Auth screens — login / signup / forgot / reset / welcome

**Files:**
- Create: `app/(auth)/layout.tsx`, `app/(auth)/login/page.tsx`, `app/(auth)/signup/page.tsx`, `app/(auth)/forgot-password/page.tsx`, `app/(auth)/reset-password/page.tsx`, `app/(auth)/welcome/page.tsx`
- Create: `features/auth/hooks.ts`

**Interfaces:**
- Consumes: `createSupabaseBrowser`, primitives (Task 2), `useEnsureProvisioned` (Task 6).
- Produces: routes `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/welcome`. Auth flow contract (consumed by Task 8): after ANY successful login the client goes to `/` — the root redirect provisions/roues; brand-new confirmed users pass through `/welcome` which calls `identity.signup` then routes by role.

- [ ] **Step 1: `features/auth/hooks.ts`** (thin wrappers so screens stay presentational)

```ts
"use client";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

export const signIn = async (email: string, password: string): Promise<string | null> => {
  const { error } = await createSupabaseBrowser().auth.signInWithPassword({ email, password });
  return error ? "Email or password is incorrect." : null;
};

// org_name rides in user_metadata so provisioning can read it AFTER email confirmation,
// when the signup form's state is long gone.
export const signUp = async (email: string, password: string, orgName: string): Promise<string | null> => {
  const { error } = await createSupabaseBrowser().auth.signUp({
    email,
    password,
    options: { data: { org_name: orgName }, emailRedirectTo: `${window.location.origin}/auth/confirm` },
  });
  return error ? error.message : null;
};

export const requestPasswordReset = async (email: string): Promise<void> => {
  await createSupabaseBrowser().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/confirm` });
};

export const updatePassword = async (password: string): Promise<string | null> => {
  const { error } = await createSupabaseBrowser().auth.updateUser({ password });
  return error ? error.message : null;
};

export const signOut = async (): Promise<void> => {
  await createSupabaseBrowser().auth.signOut();
};
```

- [ ] **Step 2: `app/(auth)/layout.tsx`** (centered card shell)

```tsx
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <p className="mb-4 text-center font-display text-2xl font-semibold">Mallet</p>
        {children}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: `app/(auth)/login/page.tsx`**

```tsx
"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { signIn } from "@/features/auth/hooks";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const failure = await signIn(String(form.get("email")), String(form.get("password")));
    if (failure) {
      setError(failure);
      setBusy(false);
      return;
    }
    router.replace("/");
  };

  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Email"><Input name="email" type="email" required autoComplete="email" /></Field>
        <Field label="Password"><Input name="password" type="password" required autoComplete="current-password" /></Field>
        {error ? <p className="text-sm text-red">{error}</p> : null}
        <Button type="submit" disabled={busy} className="w-full">Sign in</Button>
        <div className="flex justify-between text-sm">
          <Link className="text-ink-muted underline" href="/forgot-password">Forgot password</Link>
          <Link className="text-ink-muted underline" href="/signup">Create account</Link>
        </div>
      </form>
    </Card>
  );
}
```

- [ ] **Step 4: `app/(auth)/signup/page.tsx`**

```tsx
"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { signUp } from "@/features/auth/hooks";

export default function SignupPage() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const failure = await signUp(String(form.get("email")), String(form.get("password")), String(form.get("orgName")));
    if (failure) {
      setError(failure);
      setBusy(false);
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <Card>
        <p className="font-medium">Check your email</p>
        <p className="mt-1 text-sm text-ink-muted">We sent a confirmation link. Open it, then sign in.</p>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Business name"><Input name="orgName" required maxLength={80} /></Field>
        <Field label="Email"><Input name="email" type="email" required autoComplete="email" /></Field>
        <Field label="Password"><Input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
        {error ? <p className="text-sm text-red">{error}</p> : null}
        <Button type="submit" disabled={busy} className="w-full">Create account</Button>
        <p className="text-center text-sm"><Link className="text-ink-muted underline" href="/login">Back to sign in</Link></p>
      </form>
    </Card>
  );
}
```

- [ ] **Step 5: `app/(auth)/forgot-password/page.tsx`**

```tsx
"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/features/auth/hooks";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await requestPasswordReset(String(new FormData(e.currentTarget).get("email")));
    setSent(true); // same response whether or not the account exists — no oracle
  };

  return (
    <Card>
      {sent ? (
        <p className="text-sm">If that account exists, a reset link is on its way.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="Email"><Input name="email" type="email" required /></Field>
          <Button type="submit" className="w-full">Send reset link</Button>
        </form>
      )}
      <p className="mt-3 text-center text-sm"><Link className="text-ink-muted underline" href="/login">Back to sign in</Link></p>
    </Card>
  );
}
```

- [ ] **Step 6: `app/(auth)/reset-password/page.tsx`**

```tsx
"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { updatePassword } from "@/features/auth/hooks";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const failure = await updatePassword(String(new FormData(e.currentTarget).get("password")));
    if (failure) {
      setError(failure);
      return;
    }
    router.replace("/");
  };

  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="New password"><Input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
        {error ? <p className="text-sm text-red">{error}</p> : null}
        <Button type="submit" className="w-full">Set password</Button>
      </form>
    </Card>
  );
}
```

- [ ] **Step 7: `app/(auth)/welcome/page.tsx`** (provision-on-first-login, then route by role)

```tsx
"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { useEnsureProvisioned } from "@/features/identity/hooks";
import { userMessage } from "@/lib/trpc/error-map";

export default function WelcomePage() {
  const router = useRouter();
  const provision = useEnsureProvisioned();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    provision.mutate({}, { onSuccess: (me) => router.replace(me.role === "tech" ? "/my-day" : "/dashboard") });
  }, [provision, router]);

  return (
    <Card>
      {provision.isError ? (
        <p className="text-sm text-red">{userMessage(provision.error)}</p>
      ) : (
        <p className="text-sm text-ink-muted">Setting up your workspace…</p>
      )}
    </Card>
  );
}
```

- [ ] **Step 8: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: clean; `/login /signup /forgot-password /reset-password /welcome` in the route list.

```bash
git add app/\(auth\) features/auth
git commit -m "feat(web): auth screens — login/signup/forgot/reset/welcome"
```

### Task 8: Role-routed shells — root redirect, server guard, office + field layouts

**Files:**
- Create: `lib/auth/guard.ts`
- Modify: `app/page.tsx` (root redirect)
- Create: `app/(office)/layout.tsx`, `components/shell/office-nav.tsx`
- Create: `app/(field)/layout.tsx`
- Create placeholders: `app/(office)/dashboard/page.tsx`, `app/(office)/settings/page.tsx`, `app/(field)/my-day/page.tsx`
- Create: `app/(office)/error.tsx`, `app/(office)/loading.tsx`, `app/(field)/error.tsx`, `app/(field)/loading.tsx`

**Interfaces:**
- Consumes: `createSupabaseServer`, `getAppDeps().authProvider`.
- Produces: `getSessionPrincipal(): Promise<Principal | null>`, `guardRole(allowed: readonly Role[]): Promise<Principal>` (redirects wrong-role/anonymous); office nav items list (extended in Phase B/C).

- [ ] **Step 1: `lib/auth/guard.ts`**

```ts
import { redirect } from "next/navigation";
import type { Principal, Role } from "@mallet/identity";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getAppDeps } from "@/trpc/di";

// Server-side session → Principal. Uses the SAME auth path as the API (Bearer → verify → resolve),
// so shells and backend can never disagree about who the caller is.
export const getSessionPrincipal = async (): Promise<Principal | null> => {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  const result = await getAppDeps().authProvider.authenticate(token);
  return result.ok ? result.value : null;
};

// Layout guard: anonymous → login; authenticated-but-unprovisioned → welcome; wrong role → their
// own home. Defense in depth — every backend procedure re-checks the role regardless.
export const guardRole = async (allowed: readonly Role[]): Promise<Principal> => {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getSession();
  if (!data.session) redirect("/login");
  const principal = await getSessionPrincipal();
  if (!principal) redirect("/welcome");
  if (!allowed.includes(principal.role)) redirect(principal.role === "tech" ? "/my-day" : "/dashboard");
  return principal;
};
```

- [ ] **Step 2: Root redirect** — replace `app/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getSessionPrincipal } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function Root() {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getSession();
  if (!data.session) redirect("/login");
  const principal = await getSessionPrincipal();
  if (!principal) redirect("/welcome");
  redirect(principal.role === "tech" ? "/my-day" : "/dashboard");
}
```

- [ ] **Step 3: Office shell.** `components/shell/office-nav.tsx` (client; one nav, two renders — sidebar on `md+`, bottom tabs below):

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Grows in Phase B/C: customers, quotes, jobs, money, assistant.
export const OFFICE_NAV = [
  { href: "/dashboard", label: "Home" },
  { href: "/settings", label: "Settings" },
];

export function OfficeNav() {
  const pathname = usePathname();
  const linkClass = (href: string) =>
    `rounded-control px-3 py-2 text-sm ${pathname.startsWith(href) ? "bg-paper font-medium" : "text-ink-muted hover:bg-paper"}`;
  return (
    <>
      <nav className="hidden w-48 shrink-0 flex-col gap-1 border-r border-line p-3 md:flex">
        <p className="mb-2 px-3 font-display text-lg font-semibold">Mallet</p>
        {OFFICE_NAV.map((item) => (
          <Link key={item.href} href={item.href} className={linkClass(item.href)}>{item.label}</Link>
        ))}
      </nav>
      <nav className="fixed inset-x-0 bottom-0 z-10 flex justify-around border-t border-line bg-card py-1 md:hidden">
        {OFFICE_NAV.map((item) => (
          <Link key={item.href} href={item.href} className={`${linkClass(item.href)} min-h-11 content-center`}>{item.label}</Link>
        ))}
      </nav>
    </>
  );
}
```

`app/(office)/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { guardRole } from "@/lib/auth/guard";
import { OfficeNav } from "@/components/shell/office-nav";

export const dynamic = "force-dynamic";

export default async function OfficeLayout({ children }: { children: ReactNode }) {
  await guardRole(["owner", "office"]);
  return (
    <div className="flex min-h-dvh">
      <OfficeNav />
      <main className="min-w-0 flex-1 p-4 pb-20 md:p-6 md:pb-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Field shell.** `app/(field)/layout.tsx` (phone-first: single column, bottom action space):

```tsx
import type { ReactNode } from "react";
import { guardRole } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function FieldLayout({ children }: { children: ReactNode }) {
  await guardRole(["tech", "owner", "office"]); // techs live here; office roles may preview
  return (
    <div className="mx-auto min-h-dvh max-w-md">
      <header className="border-b border-line p-4">
        <p className="font-display text-lg font-semibold">Mallet</p>
      </header>
      <main className="p-4">{children}</main>
    </div>
  );
}
```

- [ ] **Step 5: Placeholders + boundaries.** `app/(office)/dashboard/page.tsx`:

```tsx
export default function DashboardPage() {
  return <p className="text-ink-muted">Dashboard lands in Phase B.</p>;
}
```

`app/(office)/settings/page.tsx`:

```tsx
export default function SettingsPage() {
  return <p className="text-ink-muted">Settings lands in Phase C.</p>;
}
```

`app/(field)/my-day/page.tsx`:

```tsx
export default function MyDayPage() {
  return <p className="text-ink-muted">My Day lands in Phase C.</p>;
}
```

`app/(office)/error.tsx` (same file duplicated for `app/(field)/error.tsx`):

```tsx
"use client";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="p-6">
      <p className="font-medium">Something went wrong.</p>
      <Button variant="quiet" className="mt-3" onClick={reset}>Try again</Button>
    </div>
  );
}
```

`app/(office)/loading.tsx` (duplicate for `(field)`):

```tsx
export default function Loading() {
  return <p className="p-6 text-sm text-ink-muted">Loading…</p>;
}
```

- [ ] **Step 6: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: clean; `/dashboard /settings /my-day` in the route list.

```bash
git add lib/auth app/page.tsx app/\(office\) app/\(field\) components/shell
git commit -m "feat(web): role-routed shells — root redirect, server guard, office + field layouts"
```

### Task 9: Playwright harness + E2E seed + auth smoke

**Files:**
- Create: `playwright.config.ts`, `e2e/auth.spec.ts`, `scripts/seed-e2e.mjs`
- Modify: `package.json` (dev dep `@playwright/test`; scripts `test:e2e`, `seed:e2e`)
- Modify: `.gitignore` (add `/test-results/`, `/playwright-report/`)

**Interfaces:**
- Produces: seeded users `owner@e2e.mallet.test` / `tech@e2e.mallet.test` (password `e2e-password-1`, pre-confirmed, one org "E2E Plumbing") — reused by ALL later E2E specs; `pnpm test:e2e`.

- [ ] **Step 1: Install**

```bash
pnpm add -D @playwright/test && pnpm exec playwright install chromium
```

- [ ] **Step 2: `scripts/seed-e2e.mjs`** (idempotent; pre-confirmed users via the admin API — dodges Supabase SMTP limits)

```js
// Seed the E2E org + users. Requires .env.local (service role + DATABASE_URL).
//   node --env-file=.env.local scripts/seed-e2e.mjs
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const PASSWORD = "e2e-password-1";
const USERS = [
  { email: "owner@e2e.mallet.test", role: "owner" },
  { email: "tech@e2e.mallet.test", role: "tech" },
];

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1 });

const ensureAuthUser = async (email) => {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = data?.users.find((u) => u.email === email);
  if (existing) return existing.id;
  const { data: created, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  return created.user.id;
};

try {
  let [org] = await sql`select id from orgs where name = 'E2E Plumbing'`;
  if (!org) [org] = await sql`insert into orgs (name) values ('E2E Plumbing') returning id`;

  for (const u of USERS) {
    const authUserId = await ensureAuthUser(u.email);
    await sql`insert into users (org_id, auth_user_id, email, role)
      values (${org.id}, ${authUserId}, ${u.email}, ${u.role})
      on conflict (auth_user_id) do nothing`;
  }
  await sql`insert into leads (org_id, name, phone) values (${org.id}, 'E2E Karen', '+15550100001')
    on conflict do nothing`;
  console.log(`seeded org ${org.id} with ${USERS.length} users`);
} finally {
  await sql.end({ timeout: 5 });
}
```

Note: if `leads` has no phone-conflict target this insert may duplicate Karen across runs — acceptable for E2E, or guard with a `select` first exactly like the org. Prefer the guard:

```js
  const [karen] = await sql`select id from leads where org_id = ${org.id} and name = 'E2E Karen'`;
  if (!karen) await sql`insert into leads (org_id, name, phone) values (${org.id}, 'E2E Karen', '+15550100001')`;
```

Add scripts to `package.json`: `"seed:e2e": "node --env-file=.env.local scripts/seed-e2e.mjs"`, `"test:e2e": "playwright test"`.

- [ ] **Step 3: `playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
```

- [ ] **Step 4: `e2e/auth.spec.ts`**

```ts
import { test, expect } from "@playwright/test";

const login = async (page: import("@playwright/test").Page, email: string) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
};

test("owner lands on the office dashboard", async ({ page }) => {
  await login(page, "owner@e2e.mallet.test");
  await page.waitForURL("**/dashboard");
  await expect(page.getByText("Mallet").first()).toBeVisible();
});

test("tech lands on My Day and cannot open office routes", async ({ page }) => {
  await login(page, "tech@e2e.mallet.test");
  await page.waitForURL("**/my-day");
  await page.goto("/dashboard");
  await page.waitForURL("**/my-day"); // office layout guard bounces tech back
});

test("anonymous is redirected to login", async ({ page }) => {
  await page.goto("/dashboard");
  await page.waitForURL("**/login");
});
```

Note on `getByLabel`: the `Field` primitive wraps the input in a `<label>`, so `getByLabel("Email")` resolves.

- [ ] **Step 5: Seed + run**

```bash
pnpm seed:e2e
pnpm test:e2e
```
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts e2e scripts/seed-e2e.mjs package.json pnpm-lock.yaml .gitignore
git commit -m "test(e2e): playwright harness, seeded org/users, auth smoke"
```

### Task 10: Phase A gate, PR, adversarial review (review lands BEFORE merge)

- [ ] **Step 1: Full gate**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:int && pnpm coverage && pnpm build && pnpm test:e2e
```
Expected: all green (coverage thresholds apply to the measured backend layers only — `app/`, `components/`, `features/`, `lib/` are outside the coverage `include`).

- [ ] **Step 2: Secret scan the diff** — `git diff main... | grep -iE "sk-ant-api|re_[A-Za-z0-9]{10}|whsec_[a-zA-Z0-9]{10}|service_role"` → must be empty.

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feat/frontend-foundation
gh pr create --base main --head feat/frontend-foundation --title "feat(web): foundation — theme, primitives, auth, identity slice, role-routed shells"
```

- [ ] **Step 4: Adversarial review** — run the established review Workflow over the slice (lenses: signup/authedNoPrincipal auth correctness, SECURITY DEFINER fn + race, session/Bearer plumbing, role-guard bypass, error/copy leaks). Fix confirmed findings, commit as `fix(web): harden foundation per adversarial review`, push. **Only after the fix commit is on the PR may it merge.**

- [ ] **Step 5: After Owen merges** — `git checkout main && git pull` before starting Phase B.

# Phase B — Office core (branch `feat/frontend-office`, PR: "feat(web): office core — customers, quotes, jobs, money, dashboard")

Branch from updated main: `git checkout main && git pull && git checkout -b feat/frontend-office`.

**Phase-wide conventions:** every list screen = `PageHeader` + optional filter `Select` + `DataTable` + `EmptyState`; every mutation button disables while pending and surfaces failures via `userMessage`; money entered in dollars and converted once at the edge (`Math.round(parseFloat(v) * 100)`); office pages are client components (data via hooks).

### Task 11: Formatters, status labels, `customers.get`, Customers screens

**Files:**
- Create: `lib/format.ts`, `lib/format.test.ts`, `lib/labels.ts`
- Modify: `modules/customers/api/lead-router.ts` (add `get`), `modules/customers/api/lead-router.int.test.ts` (cover it)
- Create: `features/customers/hooks.ts`
- Create: `app/(office)/customers/page.tsx`, `app/(office)/customers/[id]/page.tsx`, `features/customers/new-customer-sheet.tsx`
- Modify: `components/shell/office-nav.tsx` (add `{ href: "/customers", label: "Customers" }` after Home)

**Interfaces:**
- Produces: `formatMoney(cents: number): string`, `formatDate(iso: string | null): string`, `formatDateTime(iso: string | null): string`; tone maps `LEAD_STAGE_TONE`, `ESTIMATE_STATUS_TONE`, `JOB_STATUS_TONE`, `INVOICE_STATUS_TONE` (each `Record<string, BadgeTone>`); `v1.customers.get({ leadId }) → leadDTO`; hooks `useCustomers(stage?)`, `useCustomer(leadId)`, `useCreateCustomer()`.

- [ ] **Step 1: Failing format test** (`lib/format.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { formatMoney, formatDate } from "./format";

describe("format", () => {
  it("renders integer cents as dollars", () => {
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(123456)).toBe("$1,234.56");
  });
  it("renders null dates as an em dash", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("2026-07-01T15:00:00.000Z")).toMatch(/Jul/);
  });
});
```

Run `pnpm test lib/format` → FAIL (module not found).

- [ ] **Step 2: Implement `lib/format.ts` + `lib/labels.ts`**

```ts
// lib/format.ts — the ONLY place money/dates become strings (money is integer cents everywhere).
export const formatMoney = (cents: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export const formatDate = (iso: string | null): string =>
  iso ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso)) : "—";

export const formatDateTime = (iso: string | null): string =>
  iso
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso))
    : "—";
```

```ts
// lib/labels.ts — status → badge tone, one map per domain (mirrors the backend enums).
import type { BadgeTone } from "@/components/ui/badge";

export const LEAD_STAGE_TONE: Record<string, BadgeTone> = { new: "blue", contacted: "amber", quote_sent: "amber", won: "green", lost: "red" };
export const ESTIMATE_STATUS_TONE: Record<string, BadgeTone> = { draft: "neutral", sent: "blue", accepted: "green", declined: "red" };
export const JOB_STATUS_TONE: Record<string, BadgeTone> = { scheduled: "blue", in_progress: "amber", complete: "green", canceled: "neutral" };
export const INVOICE_STATUS_TONE: Record<string, BadgeTone> = { draft: "neutral", sent: "blue", partial: "amber", paid: "green", void: "neutral" };
```

Run `pnpm test lib/format` → PASS.

- [ ] **Step 3: Backend — `customers.get`.** In `modules/customers/api/lead-router.ts`, add after `create`:

```ts
get: ownerOrOffice
  .input(z.object({ leadId: z.string().uuid() }))
  .output(leadDTO)
  .query(async ({ ctx, input }) => {
    const repo = new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId);
    const lead = await repo.findById(asLeadId(input.leadId));
    if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "customer not found" });
    return toLeadDTO(lead);
  }),
```

(`asLeadId` import from `@mallet/shared/types` — already imported in the file if not, add it.) Add an int test in `modules/customers/api/lead-router.int.test.ts` following its existing createCaller pattern: created lead is `get`-able by id; a random uuid rejects NOT_FOUND; org B's caller cannot `get` org A's lead (NOT_FOUND under RLS). Run `pnpm test:int modules/customers` → PASS.

- [ ] **Step 4: Hooks** (`features/customers/hooks.ts`)

```ts
"use client";
import { api } from "@/lib/trpc/client";

export const useCustomers = (stage?: "new" | "contacted" | "quote_sent" | "won" | "lost") =>
  api.v1.customers.list.useQuery({ limit: 50, stage });

export const useCustomer = (leadId: string) => api.v1.customers.get.useQuery({ leadId });

export const useCreateCustomer = () => {
  const utils = api.useUtils();
  return api.v1.customers.create.useMutation({ onSuccess: () => utils.v1.customers.list.invalidate() });
};
```

- [ ] **Step 5: New-customer sheet** (`features/customers/new-customer-sheet.tsx`)

```tsx
"use client";
import { useState, type FormEvent } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { userMessage } from "@/lib/trpc/error-map";
import { useCreateCustomer } from "./hooks";

export function NewCustomerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateCustomer();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    create.mutate(
      { name: String(form.get("name")), phone: String(form.get("phone")) || undefined },
      { onSuccess: onClose, onError: (err) => setError(userMessage(err)) },
    );
  };

  return (
    <Sheet open={open} title="New customer" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Name"><Input name="name" required /></Field>
        <Field label="Phone"><Input name="phone" type="tel" placeholder="+1 555 000 0000" /></Field>
        {error ? <p className="text-sm text-red">{error}</p> : null}
        <Button type="submit" disabled={create.isPending}>Add customer</Button>
      </form>
    </Sheet>
  );
}
```

- [ ] **Step 6: List page** (`app/(office)/customers/page.tsx`)

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { LEAD_STAGE_TONE } from "@/lib/labels";
import { useCustomers } from "@/features/customers/hooks";
import { NewCustomerSheet } from "@/features/customers/new-customer-sheet";

export default function CustomersPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const customers = useCustomers();
  const rows = customers.data?.items ?? [];

  return (
    <div>
      <PageHeader title="Customers" action={<Button onClick={() => setCreating(true)}>New customer</Button>} />
      <NewCustomerSheet open={creating} onClose={() => setCreating(false)} />
      {customers.isLoading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <DataTable
          columns={[
            { key: "name", header: "Name", render: (r) => r.name },
            { key: "phone", header: "Phone", render: (r) => r.phone ?? "—", hideOnMobile: true },
            { key: "stage", header: "Stage", render: (r) => <Badge tone={LEAD_STAGE_TONE[r.stage] ?? "neutral"}>{r.stage.replace("_", " ")}</Badge> },
          ]}
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/customers/${r.id}`)}
          empty={<EmptyState title="No customers yet" hint="Add your first customer to start quoting." action={<Button onClick={() => setCreating(true)}>New customer</Button>} />}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 7: Detail page** (`app/(office)/customers/[id]/page.tsx`) — quotes are client-filtered from `quoting.list` (no by-lead endpoint yet; fine at pilot scale, revisit when an org exceeds ~100 estimates):

```tsx
"use client";
import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatMoney, formatDateTime } from "@/lib/format";
import { LEAD_STAGE_TONE, ESTIMATE_STATUS_TONE, JOB_STATUS_TONE } from "@/lib/labels";
import { useCustomer } from "@/features/customers/hooks";

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const customer = useCustomer(id);
  const quotes = api.v1.quoting.list.useQuery({ limit: 100 });
  const jobs = api.v1.jobs.listByLead.useQuery({ leadId: id });

  if (customer.isLoading) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (!customer.data) return <p className="text-sm text-ink-muted">Customer not found.</p>;
  const c = customer.data;
  const customerQuotes = (quotes.data?.items ?? []).filter((q) => q.leadId === id);

  return (
    <div className="space-y-4">
      <PageHeader title={c.name} action={<Button onClick={() => router.push(`/quotes/new?leadId=${id}`)}>New quote</Button>} />
      <Card className="flex flex-wrap items-center gap-3 text-sm">
        <Badge tone={LEAD_STAGE_TONE[c.stage] ?? "neutral"}>{c.stage.replace("_", " ")}</Badge>
        <span>{c.phone ?? "no phone"}</span>
        <span className="text-ink-muted">{c.email ?? ""}</span>
      </Card>
      <Card>
        <h2 className="mb-2 font-display font-semibold">Quotes</h2>
        {customerQuotes.length === 0 ? <p className="text-sm text-ink-muted">No quotes yet.</p> : (
          <ul className="space-y-1 text-sm">
            {customerQuotes.map((q) => (
              <li key={q.id}>
                <Link className="flex justify-between rounded-control px-2 py-1.5 hover:bg-paper" href={`/quotes/${q.id}`}>
                  <span>{q.num} — {q.title ?? "untitled"}</span>
                  <span className="flex items-center gap-2"><Badge tone={ESTIMATE_STATUS_TONE[q.status] ?? "neutral"}>{q.status}</Badge>{formatMoney(q.total.cents)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h2 className="mb-2 font-display font-semibold">Jobs</h2>
        {(jobs.data?.items ?? []).length === 0 ? <p className="text-sm text-ink-muted">No jobs yet.</p> : (
          <ul className="space-y-1 text-sm">
            {(jobs.data?.items ?? []).map((j) => (
              <li key={j.id}>
                <Link className="flex justify-between rounded-control px-2 py-1.5 hover:bg-paper" href={`/jobs/${j.id}`}>
                  <span>{j.num} — {j.title ?? "untitled"}</span>
                  <span className="flex items-center gap-2"><Badge tone={JOB_STATUS_TONE[j.status] ?? "neutral"}>{j.status.replace("_", " ")}</Badge>{formatDateTime(j.scheduledStart)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 8: Nav + verify + commit**

Add `{ href: "/customers", label: "Customers" }` to `OFFICE_NAV`. Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

```bash
git add lib/format* lib/labels.ts modules/customers features/customers app/\(office\)/customers components/shell/office-nav.tsx
git commit -m "feat(web): customers — list/create/detail + customers.get endpoint"
```

### Task 12: Quotes — hooks, list, composer, detail

**Files:**
- Create: `features/quotes/hooks.ts`, `features/quotes/line-editor.tsx`
- Create: `app/(office)/quotes/page.tsx`, `app/(office)/quotes/new/page.tsx`, `app/(office)/quotes/[id]/page.tsx`
- Modify: `components/shell/office-nav.tsx` (add `{ href: "/quotes", label: "Quotes" }`)

**Interfaces:**
- Consumes: `v1.quoting.*` (shapes in Global reference: `draft` input `{ leadId, title?, taxBps?, depBps?, lines: [{ description, quantity, rateCents, isOptional? }] }`; `send/accept` input `{ estimateId }`; `decline` input `{ estimateId, reason }`).
- Produces: `useQuotes(status?)`, `useQuote(estimateId)`, `useDraftQuote()`, `useSendQuote()`, `useAcceptQuote()`, `useDeclineQuote()`; `LineEditor({ lines, onChange })` with `type LineDraft = { description: string; quantity: number; rateDollars: string }`.

- [ ] **Step 1: Hooks** (`features/quotes/hooks.ts`)

```ts
"use client";
import { api } from "@/lib/trpc/client";

type EstimateStatus = "draft" | "sent" | "accepted" | "declined";

const invalidator = () => {
  const utils = api.useUtils();
  return () => Promise.all([utils.v1.quoting.list.invalidate(), utils.v1.quoting.get.invalidate()]);
};

export const useQuotes = (status?: EstimateStatus) => api.v1.quoting.list.useQuery({ limit: 50, status });
export const useQuote = (estimateId: string) => api.v1.quoting.get.useQuery({ estimateId });
export const useDraftQuote = () => {
  const invalidate = invalidator();
  return api.v1.quoting.draft.useMutation({ onSuccess: invalidate });
};
export const useSendQuote = () => {
  const invalidate = invalidator();
  return api.v1.quoting.send.useMutation({ onSuccess: invalidate });
};
export const useAcceptQuote = () => {
  const invalidate = invalidator();
  return api.v1.quoting.accept.useMutation({ onSuccess: invalidate });
};
export const useDeclineQuote = () => {
  const invalidate = invalidator();
  return api.v1.quoting.decline.useMutation({ onSuccess: invalidate });
};
```

- [ ] **Step 2: Line editor** (`features/quotes/line-editor.tsx`)

```tsx
"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type LineDraft = { description: string; quantity: number; rateDollars: string };

export function LineEditor({ lines, onChange }: { lines: LineDraft[]; onChange: (lines: LineDraft[]) => void }) {
  const update = (i: number, patch: Partial<LineDraft>) => onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      {lines.map((line, i) => (
        <div key={i} className="grid grid-cols-[1fr_5rem_7rem_auto] items-center gap-2">
          <Input placeholder="Description" value={line.description} onChange={(e) => update(i, { description: e.target.value })} required />
          <Input type="number" min={0.25} step={0.25} value={line.quantity} onChange={(e) => update(i, { quantity: Number(e.target.value) })} aria-label="Quantity" />
          <Input type="number" min={0} step={0.01} value={line.rateDollars} onChange={(e) => update(i, { rateDollars: e.target.value })} aria-label="Rate ($)" placeholder="Rate ($)" />
          <Button variant="quiet" onClick={() => onChange(lines.filter((_, idx) => idx !== i))} aria-label="Remove line">✕</Button>
        </div>
      ))}
      <Button variant="quiet" onClick={() => onChange([...lines, { description: "", quantity: 1, rateDollars: "" }])}>Add line</Button>
    </div>
  );
}
```

- [ ] **Step 3: List page** (`app/(office)/quotes/page.tsx`)

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/format";
import { ESTIMATE_STATUS_TONE } from "@/lib/labels";
import { useQuotes } from "@/features/quotes/hooks";

const STATUSES = ["draft", "sent", "accepted", "declined"] as const;

export default function QuotesPage() {
  const router = useRouter();
  const [status, setStatus] = useState<(typeof STATUSES)[number] | "">("");
  const quotes = useQuotes(status || undefined);

  return (
    <div>
      <PageHeader title="Quotes" action={<Button onClick={() => router.push("/quotes/new")}>New quote</Button>} />
      <div className="mb-3 max-w-48">
        <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </div>
      <DataTable
        columns={[
          { key: "num", header: "Quote", render: (r) => r.num },
          { key: "title", header: "Title", render: (r) => r.title ?? "—", hideOnMobile: true },
          { key: "status", header: "Status", render: (r) => <Badge tone={ESTIMATE_STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge> },
          { key: "total", header: "Total", render: (r) => formatMoney(r.total.cents) },
        ]}
        rows={quotes.data?.items ?? []}
        rowKey={(r) => r.id}
        onRowClick={(r) => router.push(`/quotes/${r.id}`)}
        empty={<EmptyState title="No quotes yet" action={<Button onClick={() => router.push("/quotes/new")}>New quote</Button>} />}
      />
    </div>
  );
}
```

- [ ] **Step 4: Composer** (`app/(office)/quotes/new/page.tsx`)

```tsx
"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { userMessage } from "@/lib/trpc/error-map";
import { useCustomers } from "@/features/customers/hooks";
import { useDraftQuote } from "@/features/quotes/hooks";
import { LineEditor, type LineDraft } from "@/features/quotes/line-editor";

const toCents = (dollars: string): number => Math.round(parseFloat(dollars || "0") * 100);
const toBps = (percent: string): number => Math.round(parseFloat(percent || "0") * 100);

export default function NewQuotePage() {
  const router = useRouter();
  const preselected = useSearchParams().get("leadId") ?? "";
  const customers = useCustomers();
  const draft = useDraftQuote();
  const [leadId, setLeadId] = useState(preselected);
  const [title, setTitle] = useState("");
  const [taxPct, setTaxPct] = useState("");
  const [depPct, setDepPct] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ description: "", quantity: 1, rateDollars: "" }]);
  const [error, setError] = useState<string | null>(null);

  const submit = () =>
    draft.mutate(
      {
        leadId,
        title: title || undefined,
        taxBps: taxPct ? toBps(taxPct) : undefined,
        depBps: depPct ? toBps(depPct) : undefined,
        lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, rateCents: toCents(l.rateDollars) })),
      },
      { onSuccess: (q) => router.push(`/quotes/${q.id}`), onError: (err) => setError(userMessage(err)) },
    );

  return (
    <div>
      <PageHeader title="New quote" />
      <Card className="space-y-3">
        <Field label="Customer">
          <Select value={leadId} onChange={(e) => setLeadId(e.target.value)} required>
            <option value="">Choose a customer…</option>
            {(customers.data?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tax %"><Input type="number" min={0} max={100} step={0.01} value={taxPct} onChange={(e) => setTaxPct(e.target.value)} /></Field>
          <Field label="Deposit %"><Input type="number" min={0} max={100} step={0.01} value={depPct} onChange={(e) => setDepPct(e.target.value)} /></Field>
        </div>
        <Field label="Line items"><LineEditor lines={lines} onChange={setLines} /></Field>
        {error ? <p className="text-sm text-red">{error}</p> : null}
        <Button onClick={submit} disabled={!leadId || draft.isPending}>Create draft</Button>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Detail** (`app/(office)/quotes/[id]/page.tsx`) — actions by status; decline reason in an in-flow `Sheet`; the accepted-state "Create job" button arrives in Task 13:

```tsx
"use client";
import { use, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet } from "@/components/ui/sheet";
import { Field, Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { ESTIMATE_STATUS_TONE } from "@/lib/labels";
import { userMessage } from "@/lib/trpc/error-map";
import { useQuote, useSendQuote, useAcceptQuote, useDeclineQuote } from "@/features/quotes/hooks";

export default function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const quote = useQuote(id);
  const send = useSendQuote();
  const accept = useAcceptQuote();
  const decline = useDeclineQuote();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const onError = (err: unknown) => setError(userMessage(err));

  if (quote.isLoading) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (!quote.data) return <p className="text-sm text-ink-muted">Quote not found.</p>;
  const q = quote.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${q.num} — ${q.title ?? "untitled"}`}
        action={
          <span className="flex gap-2">
            {q.status === "draft" ? <Button disabled={send.isPending} onClick={() => send.mutate({ estimateId: id }, { onError })}>Send to customer</Button> : null}
            {q.status === "sent" ? <Button disabled={accept.isPending} onClick={() => accept.mutate({ estimateId: id }, { onError })}>Mark accepted</Button> : null}
            {q.status === "sent" ? <Button variant="danger" onClick={() => setDeclining(true)}>Mark declined</Button> : null}
          </span>
        }
      />
      <Badge tone={ESTIMATE_STATUS_TONE[q.status] ?? "neutral"}>{q.status}</Badge>
      {error ? <p className="text-sm text-red">{error}</p> : null}
      <Sheet open={declining} title="Decline quote" onClose={() => setDeclining(false)}>
        <div className="space-y-3">
          <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} required /></Field>
          <Button variant="danger" disabled={!reason || decline.isPending}
            onClick={() => decline.mutate({ estimateId: id, reason }, { onSuccess: () => setDeclining(false), onError })}>
            Confirm decline
          </Button>
        </div>
      </Sheet>
      <Card>
        <ul className="divide-y divide-line text-sm">
          {q.lines.map((l) => (
            <li key={l.id} className="flex justify-between py-2">
              <span>{l.description}{l.isOptional ? " (optional)" : ""}</span>
              <span className="text-ink-muted">×{l.quantity}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between"><dt className="text-ink-muted">Subtotal</dt><dd>{formatMoney(q.subtotal.cents)}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-muted">Tax</dt><dd>{formatMoney(q.tax.cents)}</dd></div>
          <div className="flex justify-between font-medium"><dt>Total</dt><dd>{formatMoney(q.total.cents)}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-muted">Deposit due</dt><dd>{formatMoney(q.depositDue.cents)}</dd></div>
        </dl>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6: Nav + verify + commit**

Add `{ href: "/quotes", label: "Quotes" }` to `OFFICE_NAV`. Run `pnpm typecheck && pnpm lint && pnpm build`.

```bash
git add features/quotes app/\(office\)/quotes components/shell/office-nav.tsx
git commit -m "feat(web): quotes — list, composer, detail with send/accept/decline"
```

### Task 13: Jobs — hooks, list, detail (assign/reschedule/start/complete/cancel), create-from-quote

**Files:**
- Create: `features/jobs/hooks.ts`
- Create: `app/(office)/jobs/page.tsx`, `app/(office)/jobs/[id]/page.tsx`, `features/jobs/job-actions.tsx`
- Modify: `app/(office)/quotes/[id]/page.tsx` (accepted → "Create job" button)
- Modify: `components/shell/office-nav.tsx` (add `{ href: "/jobs", label: "Jobs" }`)

**Interfaces:**
- Consumes: `v1.jobs.*` (`assign` input `{ jobId, assigneeUserId: string | null }`; `reschedule` input `{ jobId, scheduledStart, scheduledEnd }` ISO datetimes; `cancel` input `{ jobId, reason }`; `createFromEstimate` input `{ estimateId }`), `useMembers()` from Task 6.
- Produces: `useJobs(status?)`, `useJob(jobId)`, `useCreateJobFromEstimate()`, `useAssignJob()`, `useRescheduleJob()`, `useStartJob()`, `useCompleteJob()`, `useCancelJob()`; `JobActions({ job })` panel.

- [ ] **Step 1: Hooks** (`features/jobs/hooks.ts`)

```ts
"use client";
import { api } from "@/lib/trpc/client";

type JobStatus = "scheduled" | "in_progress" | "complete" | "canceled";

const useInvalidateJobs = () => {
  const utils = api.useUtils();
  return () => Promise.all([utils.v1.jobs.list.invalidate(), utils.v1.jobs.get.invalidate(), utils.v1.jobs.listByLead.invalidate()]);
};
const mutation = <T extends { useMutation: (opts: { onSuccess: () => void }) => unknown }>(proc: T, invalidate: () => void) =>
  proc.useMutation({ onSuccess: invalidate });

export const useJobs = (status?: JobStatus) => api.v1.jobs.list.useQuery({ limit: 50, status });
export const useJob = (jobId: string) => api.v1.jobs.get.useQuery({ jobId });
export const useCreateJobFromEstimate = () => api.v1.jobs.createFromEstimate.useMutation();
export const useAssignJob = () => { const i = useInvalidateJobs(); return api.v1.jobs.assign.useMutation({ onSuccess: i }); };
export const useRescheduleJob = () => { const i = useInvalidateJobs(); return api.v1.jobs.reschedule.useMutation({ onSuccess: i }); };
export const useStartJob = () => { const i = useInvalidateJobs(); return api.v1.jobs.start.useMutation({ onSuccess: i }); };
export const useCompleteJob = () => { const i = useInvalidateJobs(); return api.v1.jobs.complete.useMutation({ onSuccess: i }); };
export const useCancelJob = () => { const i = useInvalidateJobs(); return api.v1.jobs.cancel.useMutation({ onSuccess: i }); };
```

(Drop the unused `mutation` helper if lint flags it — the explicit one-liners are the implementation.)

- [ ] **Step 2: List page** (`app/(office)/jobs/page.tsx`) — same shape as Quotes list: status `Select` over `["scheduled","in_progress","complete","canceled"]`, `DataTable` columns Job (`r.num`), Title (hideOnMobile), Status badge via `JOB_STATUS_TONE` (render `r.status.replace("_"," ")`), When (`formatDateTime(r.scheduledStart)`), Total (`formatMoney(r.total.cents)`); row click → `/jobs/${r.id}`; `EmptyState title="No jobs yet" hint="Jobs are created from accepted quotes."`. Reuse the Task 12 Step 3 structure verbatim with these substitutions.

- [ ] **Step 3: Actions panel** (`features/jobs/job-actions.tsx`)

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, Input, Select } from "@/components/ui/input";
import { userMessage } from "@/lib/trpc/error-map";
import { useMembers } from "@/features/identity/hooks";
import { useAssignJob, useRescheduleJob, useStartJob, useCompleteJob, useCancelJob } from "./hooks";

type JobLike = { id: string; status: string; assigneeUserId: string | null };

export function JobActions({ job }: { job: JobLike }) {
  const members = useMembers();
  const assign = useAssignJob();
  const reschedule = useRescheduleJob();
  const start = useStartJob();
  const complete = useCompleteJob();
  const cancel = useCancelJob();
  const [panel, setPanel] = useState<"none" | "reschedule" | "cancel">("none");
  const [error, setError] = useState<string | null>(null);
  const onError = (err: unknown) => setError(userMessage(err));
  const active = job.status === "scheduled" || job.status === "in_progress";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {job.status === "scheduled" ? <Button disabled={start.isPending} onClick={() => start.mutate({ jobId: job.id }, { onError })}>Start</Button> : null}
        {job.status === "in_progress" ? <Button disabled={complete.isPending} onClick={() => complete.mutate({ jobId: job.id }, { onError })}>Complete</Button> : null}
        {active ? <Button variant="quiet" onClick={() => setPanel("reschedule")}>Reschedule</Button> : null}
        {active ? <Button variant="danger" onClick={() => setPanel("cancel")}>Cancel job</Button> : null}
      </div>
      {active ? (
        <Field label="Assigned to">
          <Select
            value={job.assigneeUserId ?? ""}
            disabled={assign.isPending}
            onChange={(e) => assign.mutate({ jobId: job.id, assigneeUserId: e.target.value || null }, { onError })}
          >
            <option value="">Unassigned</option>
            {(members.data?.items ?? []).map((m) => <option key={m.id} value={m.id}>{m.email} ({m.role})</option>)}
          </Select>
        </Field>
      ) : null}
      {error ? <p className="text-sm text-red">{error}</p> : null}
      <Sheet open={panel === "reschedule"} title="Reschedule" onClose={() => setPanel("none")}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            reschedule.mutate(
              { jobId: job.id, scheduledStart: new Date(String(f.get("start"))).toISOString(), scheduledEnd: new Date(String(f.get("end"))).toISOString() },
              { onSuccess: () => setPanel("none"), onError },
            );
          }}
        >
          <Field label="Starts"><Input name="start" type="datetime-local" required /></Field>
          <Field label="Ends"><Input name="end" type="datetime-local" required /></Field>
          <Button type="submit" disabled={reschedule.isPending}>Save schedule</Button>
        </form>
      </Sheet>
      <Sheet open={panel === "cancel"} title="Cancel job" onClose={() => setPanel("none")}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            cancel.mutate({ jobId: job.id, reason: String(new FormData(e.currentTarget).get("reason")) }, { onSuccess: () => setPanel("none"), onError });
          }}
        >
          <Field label="Reason"><Input name="reason" required /></Field>
          <Button variant="danger" type="submit" disabled={cancel.isPending}>Confirm cancel</Button>
        </form>
      </Sheet>
    </div>
  );
}
```

- [ ] **Step 4: Detail page** (`app/(office)/jobs/[id]/page.tsx`)

```tsx
"use client";
import { use } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatDateTime } from "@/lib/format";
import { JOB_STATUS_TONE } from "@/lib/labels";
import { useJob } from "@/features/jobs/hooks";
import { JobActions } from "@/features/jobs/job-actions";

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const job = useJob(id);
  if (job.isLoading) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (!job.data) return <p className="text-sm text-ink-muted">Job not found.</p>;
  const j = job.data;

  return (
    <div className="space-y-4">
      <PageHeader title={`${j.num} — ${j.title ?? "untitled"}`} />
      <Card className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <Badge tone={JOB_STATUS_TONE[j.status] ?? "neutral"}>{j.status.replace("_", " ")}</Badge>
          <span className="font-medium">{formatMoney(j.total.cents)}</span>
        </div>
        <p className="text-ink-muted">Scheduled {formatDateTime(j.scheduledStart)} → {formatDateTime(j.scheduledEnd)}</p>
        {j.cancelReason ? <p className="text-red">Canceled: {j.cancelReason}</p> : null}
      </Card>
      <Card><JobActions job={j} /></Card>
    </div>
  );
}
```

- [ ] **Step 5: Create-from-quote.** In `app/(office)/quotes/[id]/page.tsx`, add to the header action span (imports: `useRouter`, `useCreateJobFromEstimate`):

```tsx
{q.status === "accepted" ? (
  <Button
    disabled={createJob.isPending}
    onClick={() => createJob.mutate({ estimateId: id }, { onSuccess: (j) => router.push(`/jobs/${j.id}`), onError })}
  >
    Create job
  </Button>
) : null}
```

with `const router = useRouter();` and `const createJob = useCreateJobFromEstimate();` added to the component.

- [ ] **Step 6: Nav + verify + commit**

Add `{ href: "/jobs", label: "Jobs" }` to `OFFICE_NAV`. Run `pnpm typecheck && pnpm lint && pnpm build`.

```bash
git add features/jobs app/\(office\)/jobs app/\(office\)/quotes components/shell/office-nav.tsx
git commit -m "feat(web): jobs — list, detail actions (assign/reschedule/start/complete/cancel), create-from-quote"
```

### Task 14: Money — invoices list/detail, record payment, card link, void, invoice-from-job

**Files:**
- Create: `features/invoices/hooks.ts`, `features/invoices/record-payment-sheet.tsx`
- Create: `app/(office)/money/page.tsx`, `app/(office)/money/[id]/page.tsx`
- Modify: `app/(office)/jobs/[id]/page.tsx` (complete → "Create invoice")
- Modify: `components/shell/office-nav.tsx` (add `{ href: "/money", label: "Money" }`)

**Interfaces:**
- Consumes: `v1.invoicing.*` (`recordPayment` input `{ invoiceId, amountCents, method: "card"|"ach"|"cash"|"check"|"card_terminal", idempotencyKey (min 8 chars) }`; `createPayment` input `{ invoiceId }` → `{ url }`; `createFromJob` input `{ jobId }`; `send`/`void` input `{ invoiceId }`).
- Produces: `useInvoices(status?)`, `useInvoice(invoiceId)`, `useCreateInvoiceFromJob()`, `useSendInvoice()`, `useRecordPayment()`, `useVoidInvoice()`, `useCardPaymentLink()`; `RecordPaymentSheet({ invoiceId, dueCents, open, onClose })`.

- [ ] **Step 1: Hooks** (`features/invoices/hooks.ts`)

```ts
"use client";
import { api } from "@/lib/trpc/client";

type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "void";

const useInvalidateInvoices = () => {
  const utils = api.useUtils();
  return () => Promise.all([utils.v1.invoicing.list.invalidate(), utils.v1.invoicing.get.invalidate()]);
};

export const useInvoices = (status?: InvoiceStatus) => api.v1.invoicing.list.useQuery({ limit: 50, status });
export const useInvoice = (invoiceId: string) => api.v1.invoicing.get.useQuery({ invoiceId });
export const useCreateInvoiceFromJob = () => api.v1.invoicing.createFromJob.useMutation();
export const useSendInvoice = () => { const i = useInvalidateInvoices(); return api.v1.invoicing.send.useMutation({ onSuccess: i }); };
export const useRecordPayment = () => { const i = useInvalidateInvoices(); return api.v1.invoicing.recordPayment.useMutation({ onSuccess: i }); };
export const useVoidInvoice = () => { const i = useInvalidateInvoices(); return api.v1.invoicing.void.useMutation({ onSuccess: i }); };
export const useCardPaymentLink = () => api.v1.invoicing.createPayment.useMutation();
```

- [ ] **Step 2: Record-payment sheet** (`features/invoices/record-payment-sheet.tsx`) — the idempotency key is minted ONCE per sheet-open, so a double-tap can't double-record:

```tsx
"use client";
import { useMemo, useState, type FormEvent } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { userMessage } from "@/lib/trpc/error-map";
import { useRecordPayment } from "./hooks";

const METHODS = ["cash", "check", "card_terminal", "ach", "card"] as const;

export function RecordPaymentSheet({ invoiceId, dueCents, open, onClose }: { invoiceId: string; dueCents: number; open: boolean; onClose: () => void }) {
  const record = useRecordPayment();
  const [error, setError] = useState<string | null>(null);
  // One key per sheet-open: retries of THIS submission dedupe server-side at the payments ledger.
  const idempotencyKey = useMemo(() => (open ? crypto.randomUUID() : ""), [open]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    record.mutate(
      {
        invoiceId,
        amountCents: Math.round(parseFloat(String(form.get("amount"))) * 100),
        method: form.get("method") as (typeof METHODS)[number],
        idempotencyKey,
      },
      { onSuccess: onClose, onError: (err) => setError(userMessage(err)) },
    );
  };

  return (
    <Sheet open={open} title="Record payment" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Amount ($)">
          <Input name="amount" type="number" min={0.01} step={0.01} defaultValue={(dueCents / 100).toFixed(2)} required />
        </Field>
        <Field label="Method">
          <Select name="method" defaultValue="cash">
            {METHODS.map((m) => <option key={m} value={m}>{m.replace("_", " ")}</option>)}
          </Select>
        </Field>
        {error ? <p className="text-sm text-red">{error}</p> : null}
        <Button type="submit" disabled={record.isPending}>Record payment</Button>
      </form>
    </Sheet>
  );
}
```

- [ ] **Step 3: List page** (`app/(office)/money/page.tsx`) — same list shape: status `Select` over `["draft","sent","partial","paid","void"]`, columns Invoice (`r.num`), Status badge (`INVOICE_STATUS_TONE`), Total (`formatMoney(r.total.cents)`), Due (`formatMoney(r.due.cents)`); row click → `/money/${r.id}`; `EmptyState title="No invoices yet" hint="Create one from a completed job."`. Reuse the Task 12 Step 3 structure with these substitutions (summary DTO has `due` — verify field on `summaryDTO`; if absent, show Total only).

- [ ] **Step 4: Detail page** (`app/(office)/money/[id]/page.tsx`)

```tsx
"use client";
import { use, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatDate } from "@/lib/format";
import { INVOICE_STATUS_TONE } from "@/lib/labels";
import { userMessage } from "@/lib/trpc/error-map";
import { useInvoice, useSendInvoice, useVoidInvoice, useCardPaymentLink } from "@/features/invoices/hooks";
import { RecordPaymentSheet } from "@/features/invoices/record-payment-sheet";

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const invoice = useInvoice(id);
  const send = useSendInvoice();
  const voidInvoice = useVoidInvoice();
  const cardLink = useCardPaymentLink();
  const [recording, setRecording] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onError = (err: unknown) => setError(userMessage(err));

  if (invoice.isLoading) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (!invoice.data) return <p className="text-sm text-ink-muted">Invoice not found.</p>;
  const inv = invoice.data;
  const payable = inv.status === "sent" || inv.status === "partial";

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${inv.num} — ${inv.title ?? "untitled"}`}
        action={
          <span className="flex flex-wrap gap-2">
            {inv.status === "draft" ? <Button disabled={send.isPending} onClick={() => send.mutate({ invoiceId: id }, { onError })}>Send invoice</Button> : null}
            {payable ? <Button onClick={() => setRecording(true)}>Record payment</Button> : null}
            {payable ? (
              <Button variant="quiet" disabled={cardLink.isPending} onClick={() => cardLink.mutate({ invoiceId: id }, { onError })}>
                Card payment link
              </Button>
            ) : null}
            {inv.status === "draft" || inv.status === "sent" ? (
              confirmVoid
                ? <Button variant="danger" disabled={voidInvoice.isPending} onClick={() => voidInvoice.mutate({ invoiceId: id }, { onError })}>Confirm void</Button>
                : <Button variant="danger" onClick={() => setConfirmVoid(true)}>Void</Button>
            ) : null}
          </span>
        }
      />
      <div className="flex items-center gap-3">
        <Badge tone={INVOICE_STATUS_TONE[inv.status] ?? "neutral"}>{inv.status}</Badge>
        <span className="text-sm text-ink-muted">Due {formatDate(inv.dueAt)}</span>
      </div>
      {error ? <p className="text-sm text-red">{error}</p> : null}
      {cardLink.data ? (
        <Card className="text-sm">
          <p className="font-medium">Card payment link (send to the customer):</p>
          <a className="break-all text-blue underline" href={cardLink.data.url} target="_blank" rel="noreferrer">{cardLink.data.url}</a>
        </Card>
      ) : null}
      <RecordPaymentSheet invoiceId={id} dueCents={inv.due.cents} open={recording} onClose={() => setRecording(false)} />
      <Card>
        <ul className="divide-y divide-line text-sm">
          {inv.lines.map((l, i) => <li key={i} className="flex justify-between py-2"><span>{l.description}</span><span className="text-ink-muted">×{l.quantity}</span></li>)}
        </ul>
        <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between font-medium"><dt>Total</dt><dd>{formatMoney(inv.total.cents)}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-muted">Paid</dt><dd>{formatMoney(inv.amountPaid.cents)}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-muted">Balance due</dt><dd>{formatMoney(inv.due.cents)}</dd></div>
        </dl>
      </Card>
      {inv.payments.length > 0 ? (
        <Card>
          <h2 className="mb-2 font-display font-semibold">Payments</h2>
          <ul className="divide-y divide-line text-sm">
            {inv.payments.map((p, i) => (
              <li key={i} className="flex justify-between py-2"><span>{p.method.replace("_", " ")}</span><span>{formatMoney(p.amount.cents)}</span></li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
```

Note: `paymentDTO` field names — verify `amount` vs `amountCents` in `modules/invoicing/api/invoice-router.ts` lines 31-35 before writing; adjust the render accordingly.

- [ ] **Step 5: Invoice-from-job.** In `app/(office)/jobs/[id]/page.tsx` add (imports: `useRouter`, `useCreateInvoiceFromJob`, `Button`, plus `userMessage` state):

```tsx
{j.status === "complete" ? (
  <Button disabled={createInvoice.isPending}
    onClick={() => createInvoice.mutate({ jobId: id }, { onSuccess: (inv) => router.push(`/money/${inv.id}`), onError })}>
    Create invoice
  </Button>
) : null}
```

placed inside the actions `Card` above `<JobActions job={j} />`, with `const createInvoice = useCreateInvoiceFromJob();`, `const router = useRouter();`, and a local `error`/`onError` pair mirroring the quote-detail pattern.

- [ ] **Step 6: Nav + verify + commit**

Add `{ href: "/money", label: "Money" }` to `OFFICE_NAV`. Run `pnpm typecheck && pnpm lint && pnpm build`.

```bash
git add features/invoices app/\(office\)/money app/\(office\)/jobs components/shell/office-nav.tsx
git commit -m "feat(web): money — invoices, record payment (idempotent), card link, void, invoice-from-job"
```

### Task 15: Dashboard

**Files:**
- Modify: `app/(office)/dashboard/page.tsx` (replace placeholder)

**Interfaces:**
- Consumes: `useJobs`, `useInvoices`, `useCustomers` (existing hooks only — no new endpoints).

- [ ] **Step 1: Implement**

```tsx
"use client";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatDateTime } from "@/lib/format";
import { JOB_STATUS_TONE } from "@/lib/labels";
import { useJobs } from "@/features/jobs/hooks";
import { useInvoices } from "@/features/invoices/hooks";
import { useCustomers } from "@/features/customers/hooks";

function Section({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display font-semibold">{title}</h2>
        <Link href={href} className="text-sm text-ink-muted underline">View all</Link>
      </div>
      {children}
    </Card>
  );
}

export default function DashboardPage() {
  const scheduled = useJobs("scheduled");
  const inProgress = useJobs("in_progress");
  const sent = useInvoices("sent");
  const partial = useInvoices("partial");
  const customers = useCustomers();

  const upcoming = [...(inProgress.data?.items ?? []), ...(scheduled.data?.items ?? [])].slice(0, 5);
  const unpaid = [...(partial.data?.items ?? []), ...(sent.data?.items ?? [])];
  const outstanding = unpaid.reduce((sum, inv) => sum + inv.due.cents, 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Home" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Today's work" href="/jobs">
          {upcoming.length === 0 ? <p className="text-sm text-ink-muted">Nothing scheduled.</p> : (
            <ul className="space-y-1 text-sm">
              {upcoming.map((j) => (
                <li key={j.id}>
                  <Link href={`/jobs/${j.id}`} className="flex justify-between rounded-control px-2 py-1.5 hover:bg-paper">
                    <span>{j.num} — {j.title ?? "untitled"}</span>
                    <span className="flex items-center gap-2"><Badge tone={JOB_STATUS_TONE[j.status] ?? "neutral"}>{j.status.replace("_", " ")}</Badge>{formatDateTime(j.scheduledStart)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={`Waiting on ${formatMoney(outstanding)}`} href="/money">
          {unpaid.length === 0 ? <p className="text-sm text-ink-muted">Nothing outstanding.</p> : (
            <ul className="space-y-1 text-sm">
              {unpaid.slice(0, 5).map((inv) => (
                <li key={inv.id}>
                  <Link href={`/money/${inv.id}`} className="flex justify-between rounded-control px-2 py-1.5 hover:bg-paper">
                    <span>{inv.num}</span><span>{formatMoney(inv.due.cents)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Newest customers" href="/customers">
          {(customers.data?.items ?? []).length === 0 ? <p className="text-sm text-ink-muted">No customers yet.</p> : (
            <ul className="space-y-1 text-sm">
              {(customers.data?.items ?? []).slice(0, 5).map((c) => (
                <li key={c.id}><Link href={`/customers/${c.id}`} className="block rounded-control px-2 py-1.5 hover:bg-paper">{c.name}</Link></li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
```

(Typo guard: `customers.data?items` must be `customers.data?.items` — fix when writing.) Note: `summaryDTO.due` — confirmed in Task 14 Step 3; if the summary lacks `due`, substitute `total`.

- [ ] **Step 2: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm build`

```bash
git add app/\(office\)/dashboard
git commit -m "feat(web): dashboard — today's work, outstanding money, newest customers"
```

### Task 16: Golden-path E2E, Phase B gate, PR, review

- [ ] **Step 1: `e2e/golden.spec.ts`**

```ts
import { test, expect, type Page } from "@playwright/test";

const login = async (page: Page) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@e2e.mallet.test");
  await page.getByLabel("Password").fill("e2e-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
};

test("golden path: customer → quote → accept → job → complete → invoice → paid", async ({ page }) => {
  const name = `Golden ${Date.now()}`;
  await login(page);

  // Customer
  await page.goto("/customers");
  await page.getByRole("button", { name: "New customer" }).first().click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Add customer" }).click();
  await page.getByText(name).first().click();

  // Quote
  await page.getByRole("button", { name: "New quote" }).click();
  await page.getByPlaceholder("Description").fill("Panel replacement");
  await page.getByLabel("Rate ($)").fill("450");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByRole("button", { name: "Send to customer" }).click();
  await page.getByRole("button", { name: "Mark accepted" }).click();

  // Job
  await page.getByRole("button", { name: "Create job" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Complete" }).click();

  // Invoice + payment
  await page.getByRole("button", { name: "Create invoice" }).click();
  await page.getByRole("button", { name: "Send invoice" }).click();
  await page.getByRole("button", { name: "Record payment" }).first().click();
  await page.getByRole("button", { name: "Record payment" }).last().click(); // submit with prefilled full balance
  await expect(page.getByText("paid").first()).toBeVisible();
});
```

- [ ] **Step 2: Run** — `pnpm seed:e2e && pnpm test:e2e` → all specs pass. If a step's accessible name is ambiguous, prefer tightening the COMPONENT's accessible names (e.g. distinct button labels) over loosening the test.

- [ ] **Step 3: Full gate**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:int && pnpm coverage && pnpm build && pnpm test:e2e
```

- [ ] **Step 4: Push + PR + adversarial review** (same procedure as Task 10: secret-scan, `gh pr create --base main --head feat/frontend-office`, run the review Workflow — lenses: money-input correctness (dollars→cents), idempotency-key lifecycle, mutation/invalidation coverage, role/data leaks in office screens, a11y/mobile collapse — fix confirmed findings, commit `fix(web): harden office core per adversarial review`, push, THEN merge).

# Phase C — Assistant + field (branch `feat/frontend-assistant-field`, PR: "feat(web): assistant chat + tech field view")

Branch from updated main: `git checkout main && git pull && git checkout -b feat/frontend-assistant-field`.

### Task 17: `v1.field` backend — myDay / start / complete with tech assignee guard

**Files:**
- Create: `modules/jobs/api/job-dto.ts` (extract the DTO mapping so both routers share it)
- Modify: `modules/jobs/api/job-router.ts` (import DTOs from `./job-dto` instead of defining inline)
- Create: `modules/jobs/api/field-router.ts`
- Create: `modules/jobs/api/field-router.int.test.ts`
- Modify: `modules/jobs/index.ts` (export `createFieldRouter`), `trpc/root.ts` (mount `field: createFieldRouter()`)

**Interfaces:**
- Consumes: `anyRole` from `@/trpc/init` (Task 3), existing `ListJobsUseCase`/`StartJobUseCase`/`CompleteJobUseCase`, `DrizzleJobRepository`.
- Produces:
  - `v1.field.myDay` — query, output `{ items: jobSummaryDTO[] }` (in_progress first, then scheduled by `scheduledStart`), only jobs where `assignee_user_id = principal.userId`
  - `v1.field.start` / `v1.field.complete` — mutations `{ jobId }` → `jobDTO`; `tech` role must be the assignee (FORBIDDEN otherwise); owner/office pass unguarded

- [ ] **Step 1: Extract `modules/jobs/api/job-dto.ts`** — move `moneyDTO`, `statusEnum`, `jobDTO`, `jobSummaryDTO`, `toJobDTO`, `toJobSummaryDTO` (exact code currently in `job-router.ts`) into the new file with `export` on each; update `job-router.ts` to `import { jobDTO, jobSummaryDTO, toJobDTO, toJobSummaryDTO } from "./job-dto";` and delete the inline copies. Run `pnpm test:int modules/jobs` — existing suite still green (pure move).

- [ ] **Step 2: Write the failing int test** (`modules/jobs/api/field-router.int.test.ts`) — createCaller pattern; seed org + two users (`techA`, `techB` — insert `users` rows via admin sql like `identity.int.test.ts`) + a lead + two jobs via admin insert (`status 'scheduled'`, `assignee_user_id` = techA / techB respectively):

```ts
it("myDay returns only MY active jobs", ...);          // techA sees 1 (their own), not techB's
it("tech can start/complete their OWN job", ...);      // start → in_progress; complete → complete
it("tech gets FORBIDDEN on someone else's job", ...);  // techA on techB's job → FORBIDDEN, status unchanged
it("owner can start any job through the field surface", ...);
```

Use the same ctx recipe as `identity.int.test.ts` (Task 4), with `principal.userId` = the seeded users-row id (that's what `assignee_user_id` references). Run `pnpm test:int modules/jobs` → FAIL (`v1.field` missing).

- [ ] **Step 3: Implement** (`modules/jobs/api/field-router.ts`)

```ts
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { toPage, asJobId, orThrow } from "@mallet/shared/types";
import type { Principal } from "@mallet/identity";
import { router, anyRole } from "@/trpc/init";
import { DrizzleJobRepository } from "../infra/drizzle-job-repository";
import { ListJobsUseCase } from "../app/list-jobs";
import { StartJobUseCase } from "../app/start-job";
import { CompleteJobUseCase } from "../app/complete-job";
import type { JobId } from "@mallet/shared/types";
import { jobDTO, jobSummaryDTO, toJobDTO, toJobSummaryDTO } from "./job-dto";

// The tech-facing surface. Assignment is the authorization boundary for techs: a tech may act only
// on jobs assigned to them (owner/office pass — they already hold the office surface). This check
// lives at the API layer, where the codebase makes its role-based FORBIDDEN decisions.
const assertMineIfTech = async (repo: DrizzleJobRepository, jobId: JobId, principal: Principal): Promise<void> => {
  if (principal.role !== "tech") return;
  const job = await repo.findById(jobId);
  if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
  if (job.props.assigneeUserId !== principal.userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "this job isn't assigned to you" });
  }
};

const jobIdInput = z.object({ jobId: z.string().uuid() });

export const createFieldRouter = () =>
  router({
    myDay: anyRole.output(z.object({ items: z.array(jobSummaryDTO) })).query(async ({ ctx }) => {
      const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
      const useCase = new ListJobsUseCase(repo);
      const mine = { assigneeUserId: ctx.principal.userId };
      // Sequential on purpose: one tx = one connection.
      const inProgress = await useCase.exec({ page: toPage({ limit: 50, cursor: null }), filter: { ...mine, status: "in_progress" } });
      const scheduled = await useCase.exec({ page: toPage({ limit: 50, cursor: null }), filter: { ...mine, status: "scheduled" } });
      return { items: [...inProgress.items, ...scheduled.items].map(toJobSummaryDTO) };
    }),

    start: anyRole.input(jobIdInput).output(jobDTO).mutation(async ({ ctx, input }) => {
      const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
      const jobId = asJobId(input.jobId);
      await assertMineIfTech(repo, jobId, ctx.principal);
      return toJobDTO(orThrow(await new StartJobUseCase(repo, ctx.deps.bus, ctx.deps.clock).exec({ jobId })));
    }),

    complete: anyRole.input(jobIdInput).output(jobDTO).mutation(async ({ ctx, input }) => {
      const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
      const jobId = asJobId(input.jobId);
      await assertMineIfTech(repo, jobId, ctx.principal);
      return toJobDTO(orThrow(await new CompleteJobUseCase(repo, ctx.deps.bus, ctx.deps.clock).exec({ jobId })));
    }),
  });
```

(Verify at implementation time: `orThrow`'s import path and `Start/CompleteJobUseCase` constructor args must match `job-router.ts`'s existing usage exactly — copy from there.) Export from `modules/jobs/index.ts`; mount in `trpc/root.ts` as `field: createFieldRouter(),`.

- [ ] **Step 4: Run int tests** — `pnpm test:int modules/jobs` → PASS (existing + 4 new).

- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:int && pnpm build
git add modules/jobs trpc/root.ts
git commit -m "feat(field): v1.field — myDay/start/complete with tech assignee guard"
```

### Task 18: My Day — tech field screens (phone-first)

**Files:**
- Create: `features/field/hooks.ts`
- Modify: `app/(field)/my-day/page.tsx` (replace placeholder)
- Create: `app/(field)/my-day/[id]/page.tsx`

**Interfaces:**
- Consumes: `v1.field.*` (Task 17).
- Produces: `useMyDay()`, `useFieldStart()`, `useFieldComplete()`.

- [ ] **Step 1: Hooks** (`features/field/hooks.ts`)

```ts
"use client";
import { api } from "@/lib/trpc/client";

export const useMyDay = () => api.v1.field.myDay.useQuery(undefined, { refetchInterval: 60_000 });
export const useFieldStart = () => {
  const utils = api.useUtils();
  return api.v1.field.start.useMutation({ onSuccess: () => utils.v1.field.myDay.invalidate() });
};
export const useFieldComplete = () => {
  const utils = api.useUtils();
  return api.v1.field.complete.useMutation({ onSuccess: () => utils.v1.field.myDay.invalidate() });
};
```

- [ ] **Step 2: My Day list** (`app/(field)/my-day/page.tsx`)

```tsx
"use client";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/format";
import { JOB_STATUS_TONE } from "@/lib/labels";
import { useMyDay } from "@/features/field/hooks";

export default function MyDayPage() {
  const myDay = useMyDay();
  const jobs = myDay.data?.items ?? [];

  if (myDay.isLoading) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (jobs.length === 0) return <EmptyState title="No jobs assigned" hint="When the office assigns you work, it shows up here." />;

  return (
    <ul className="space-y-3">
      {jobs.map((j) => (
        <li key={j.id}>
          <Link href={`/my-day/${j.id}`}>
            <Card className="active:bg-paper">
              <div className="flex items-center justify-between">
                <p className="font-medium">{j.num} — {j.title ?? "untitled"}</p>
                <Badge tone={JOB_STATUS_TONE[j.status] ?? "neutral"}>{j.status.replace("_", " ")}</Badge>
              </div>
              <p className="mt-1 text-sm text-ink-muted">{formatDateTime(j.scheduledStart)}</p>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Job action screen** (`app/(field)/my-day/[id]/page.tsx`) — detail comes from the myDay cache (completed jobs drop off the list, which is the intended end state):

```tsx
"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatMoney } from "@/lib/format";
import { JOB_STATUS_TONE } from "@/lib/labels";
import { userMessage } from "@/lib/trpc/error-map";
import { useMyDay, useFieldStart, useFieldComplete } from "@/features/field/hooks";

export default function FieldJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const myDay = useMyDay();
  const start = useFieldStart();
  const complete = useFieldComplete();
  const [error, setError] = useState<string | null>(null);
  const onError = (err: unknown) => setError(userMessage(err));

  if (myDay.isLoading) return <p className="text-sm text-ink-muted">Loading…</p>;
  const job = (myDay.data?.items ?? []).find((j) => j.id === id);
  if (!job) {
    return (
      <div className="space-y-3">
        <p className="text-sm">This job is done or no longer assigned to you.</p>
        <Link className="text-sm underline" href="/my-day">Back to My Day</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link className="text-sm text-ink-muted underline" href="/my-day">← My Day</Link>
      <Card className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="font-display text-lg font-semibold">{job.num} — {job.title ?? "untitled"}</p>
          <Badge tone={JOB_STATUS_TONE[job.status] ?? "neutral"}>{job.status.replace("_", " ")}</Badge>
        </div>
        <p className="text-sm text-ink-muted">Scheduled {formatDateTime(job.scheduledStart)}</p>
        <p className="text-sm">{formatMoney(job.total.cents)}</p>
      </Card>
      {error ? <p className="text-sm text-red">{error}</p> : null}
      {job.status === "scheduled" ? (
        <Button className="min-h-14 w-full text-base" disabled={start.isPending} onClick={() => start.mutate({ jobId: id }, { onError })}>
          Start job
        </Button>
      ) : null}
      {job.status === "in_progress" ? (
        <Button className="min-h-14 w-full text-base" disabled={complete.isPending}
          onClick={() => complete.mutate({ jobId: id }, { onSuccess: () => router.push("/my-day"), onError })}>
          Mark complete
        </Button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm build`

```bash
git add features/field app/\(field\)
git commit -m "feat(web): My Day — tech field view, start/complete with big touch targets"
```

### Task 19: Assistant — agent chat with approval cards

**Files:**
- Create: `features/assistant/use-assistant.ts`, `features/assistant/approval-card.tsx`
- Create: `app/(office)/assistant/page.tsx`
- Modify: `components/shell/office-nav.tsx` (add `{ href: "/assistant", label: "Assistant" }`)

**Interfaces:**
- Consumes: `v1.ai.run({ message })` / `v1.ai.resume({ transcript, approvedToolUseIds?, deniedToolUseIds? })` → `{ status: "completed"|"needs_approval"|"refused", text, pending: { toolUseId, tool, argsJson }[], transcript }`.
- Produces: `useAssistant()` → `{ items, pending, busy, error, send(message), approveAll(), denyAll() }` with `type ChatItem = { role: "user" | "assistant"; text: string }`.

- [ ] **Step 1: The state hook** (`features/assistant/use-assistant.ts`)

```ts
"use client";
import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { userMessage } from "@/lib/trpc/error-map";

export type ChatItem = { role: "user" | "assistant"; text: string };
export type PendingAction = { toolUseId: string; tool: string; argsJson: string };

// One agent conversation. Approval is ALL-OR-NOTHING per pause (the loop typically pauses on a
// single action); the transcript is opaque server state we just round-trip.
export function useAssistant() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = api.v1.ai.run.useMutation();
  const resume = api.v1.ai.resume.useMutation();
  const busy = run.isPending || resume.isPending;

  const absorb = (result: { status: string; text: string; pending: PendingAction[]; transcript: string }) => {
    setTranscript(result.transcript);
    setPending(result.status === "needs_approval" ? result.pending : []);
    const text = result.status === "refused" ? "I can't help with that request." : result.text;
    if (text) setItems((prev) => [...prev, { role: "assistant", text }]);
  };
  const fail = (err: unknown) => setError(userMessage(err));

  const send = (message: string) => {
    setError(null);
    setItems((prev) => [...prev, { role: "user", text: message }]);
    run.mutate({ message }, { onSuccess: absorb, onError: fail });
  };

  const resolveApprovals = (approved: boolean) => {
    if (!transcript) return;
    setError(null);
    const ids = pending.map((p) => p.toolUseId);
    setPending([]);
    resume.mutate(
      { transcript, approvedToolUseIds: approved ? ids : [], deniedToolUseIds: approved ? [] : ids },
      { onSuccess: absorb, onError: fail },
    );
  };

  return { items, pending, busy, error, send, approveAll: () => resolveApprovals(true), denyAll: () => resolveApprovals(false) };
}
```

- [ ] **Step 2: Approval card** (`features/assistant/approval-card.tsx`)

```tsx
"use client";
import { Button } from "@/components/ui/button";
import type { PendingAction } from "./use-assistant";

const summarizeArgs = (argsJson: string): string => {
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    return Object.entries(args).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join("\n");
  } catch {
    return argsJson;
  }
};

export function ApprovalCard({ pending, busy, onApprove, onDeny }: { pending: PendingAction[]; busy: boolean; onApprove: () => void; onDeny: () => void }) {
  return (
    <div className="rounded-card border border-amber bg-amber-bg p-4">
      <p className="font-medium text-amber">The assistant wants to take an action</p>
      {pending.map((p) => (
        <div key={p.toolUseId} className="mt-2 rounded-control bg-card p-3 text-sm">
          <p className="font-medium">{p.tool.replace("_", " ")}</p>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-ink-muted">{summarizeArgs(p.argsJson)}</pre>
        </div>
      ))}
      <div className="mt-3 flex gap-2">
        <Button disabled={busy} onClick={onApprove}>Approve & continue</Button>
        <Button variant="quiet" disabled={busy} onClick={onDeny}>Deny</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: The page** (`app/(office)/assistant/page.tsx`)

```tsx
"use client";
import { useState, type FormEvent } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { useAssistant } from "@/features/assistant/use-assistant";
import { ApprovalCard } from "@/features/assistant/approval-card";

export default function AssistantPage() {
  const { items, pending, busy, error, send, approveAll, denyAll } = useAssistant();
  const [draft, setDraft] = useState("");
  const notConfigured = error === "That feature isn't set up yet for this account.";

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!draft.trim() || busy) return;
    send(draft.trim());
    setDraft("");
  };

  return (
    <div className="flex min-h-[70dvh] flex-col">
      <PageHeader title="Assistant" />
      <div className="flex-1 space-y-3">
        {items.length === 0 ? (
          <EmptyState title="Ask the assistant" hint='Try "list our customers" or "draft a quote for Karen — 2 hours of labor at $150".' />
        ) : (
          items.map((item, i) => (
            <div key={i} className={`max-w-[90%] rounded-card border p-3 text-sm ${item.role === "user" ? "ml-auto border-line bg-paper" : "border-line bg-card"}`}>
              <p className="whitespace-pre-wrap">{item.text}</p>
            </div>
          ))
        )}
        {pending.length > 0 ? <ApprovalCard pending={pending} busy={busy} onApprove={approveAll} onDeny={denyAll} /> : null}
        {busy ? <p className="text-sm text-ink-muted">Working…</p> : null}
        {error && !notConfigured ? <p className="text-sm text-red">{error}</p> : null}
        {notConfigured ? <EmptyState title="Assistant isn't configured" hint="Add the Anthropic API key to enable it." /> : null}
      </div>
      <form onSubmit={onSubmit} className="mt-4 flex gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask, or tell it what to do…" aria-label="Message" />
        <Button type="submit" disabled={busy || !draft.trim()}>Send</Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Nav + verify + commit**

Add `{ href: "/assistant", label: "Assistant" }` to `OFFICE_NAV`. Run `pnpm typecheck && pnpm lint && pnpm build`.

```bash
git add features/assistant app/\(office\)/assistant components/shell/office-nav.tsx
git commit -m "feat(web): assistant — agent chat with human-approval cards"
```

### Task 20: Settings, phase E2E, Phase C gate + PR + review

**Files:**
- Modify: `app/(office)/settings/page.tsx`
- Create: `e2e/field.spec.ts`, `e2e/assistant.spec.ts`

- [ ] **Step 1: Settings** (`app/(office)/settings/page.tsx`)

```tsx
"use client";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMe } from "@/features/identity/hooks";
import { signOut } from "@/features/auth/hooks";

export default function SettingsPage() {
  const router = useRouter();
  const me = useMe();

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" />
      <Card className="space-y-1 text-sm">
        <p><span className="text-ink-muted">Business:</span> {me.data?.orgName ?? "…"}</p>
        <p><span className="text-ink-muted">Signed in as:</span> {me.data?.email ?? "…"} ({me.data?.role ?? ""})</p>
      </Card>
      <Button variant="quiet" onClick={async () => { await signOut(); router.replace("/login"); }}>Sign out</Button>
    </div>
  );
}
```

Also add a Sign out affordance to the field shell: in `app/(field)/layout.tsx` header, a small client component `components/shell/sign-out-button.tsx` (`"use client"`, calls `signOut()` then `location.assign("/login")`) rendered right-aligned.

- [ ] **Step 2: `e2e/field.spec.ts`** (office assigns → tech works it)

```ts
import { test, expect, type Page } from "@playwright/test";

const login = async (page: Page, email: string, expectedPath: string) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**${expectedPath}`);
};

test("office assigns a job; tech sees it on My Day, starts and completes it", async ({ page }) => {
  const name = `Field ${Date.now()}`;
  await login(page, "owner@e2e.mallet.test", "/dashboard");

  // Fastest path to an assignable job: customer → quote → accept → job.
  await page.goto("/customers");
  await page.getByRole("button", { name: "New customer" }).first().click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Add customer" }).click();
  await page.getByText(name).first().click();
  await page.getByRole("button", { name: "New quote" }).click();
  await page.getByPlaceholder("Description").fill("Water heater swap");
  await page.getByLabel("Rate ($)").fill("900");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByRole("button", { name: "Send to customer" }).click();
  await page.getByRole("button", { name: "Mark accepted" }).click();
  await page.getByRole("button", { name: "Create job" }).click();
  await page.getByLabel("Assigned to").selectOption({ label: "tech@e2e.mallet.test (tech)" });
  const jobUrl = page.url();

  // Tech side.
  await page.context().clearCookies();
  await login(page, "tech@e2e.mallet.test", "/my-day");
  await page.getByText("Water heater swap").first().click();
  await page.getByRole("button", { name: "Start job" }).click();
  await page.getByRole("button", { name: "Mark complete" }).click();
  await page.waitForURL("**/my-day");

  // The office route stays forbidden for the tech.
  await page.goto(jobUrl);
  await page.waitForURL("**/my-day");
});
```

- [ ] **Step 3: `e2e/assistant.spec.ts`** (hits real Claude — opt-in like the backend's live tests)

```ts
import { test, expect } from "@playwright/test";

test("assistant answers a read question (LIVE Anthropic — opt-in)", async ({ page }) => {
  test.skip(!process.env.E2E_AI, "set E2E_AI=1 to run the live assistant spec");
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@e2e.mallet.test");
  await page.getByLabel("Password").fill("e2e-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
  await page.goto("/assistant");
  await page.getByLabel("Message").fill("How many customers do we have? Answer with just details from customer_list.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator("text=/customer/i").last()).toBeVisible({ timeout: 60_000 });
});
```

- [ ] **Step 4: Full gate + PR + review**

```bash
pnpm seed:e2e && pnpm typecheck && pnpm lint && pnpm test && pnpm test:int && pnpm coverage && pnpm build && pnpm test:e2e
git add app/\(office\)/settings app/\(field\) components/shell e2e
git commit -m "feat(web): settings + field/assistant e2e"
git push -u origin feat/frontend-assistant-field
gh pr create --base main --head feat/frontend-assistant-field --title "feat(web): assistant chat + tech field view"
```

Adversarial review (lenses: field assignee-guard bypass, myDay tenancy, assistant transcript handling/approval-state races, chat error/refusal honesty, mobile a11y) → fix confirmed findings → commit `fix(web): harden assistant+field per adversarial review` → push → THEN merge.

# Phase D — Production cutover (runbook; config-only PR where files change)

### Task 21: trymallet.com goes live

**Files (only these are code changes):**
- Modify: `vercel.json` if the cron cadence decision requires it; `.env.example` documenting every production env name.

- [ ] **Step 1: ROTATE all burned credentials** (they were pasted in chat) — Supabase service_role + DB password (Supabase dashboard → Settings), Anthropic key (console.anthropic.com), Resend key. Update `.env.local`; re-run `pnpm db:setup-role` if the DB password changed (updates nothing in git).
- [ ] **Step 2: Create the Vercel project** — `vercel link` in `mallet-app/` (new project `mallet-app`, team default), then set production env vars: `vercel env add production` for each of: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `APP_DATABASE_URL`, `PUBLIC_APP_URL=https://trymallet.com`, `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (from Step 5), `RESEND_API_KEY` + `EMAIL_FROM` (only once the sending domain is verified — else omit so email stays stubbed), `CRON_SECRET` (fresh 32+ chars). Omit all `TWILIO_*` (SMS stays off until the trial exits).
- [ ] **Step 3: Supabase Auth config** — Dashboard → Auth → URL configuration: Site URL `https://trymallet.com`; Redirect URLs add `https://trymallet.com/auth/confirm` and `https://trymallet.com/**`. Keep email confirmation ON (built-in SMTP for pilot; switch SMTP to Resend after domain verification).
- [ ] **Step 4: Domain move** — Vercel dashboard: remove `trymallet.com` from the `mallet-site` project, add it to `mallet-app` (DNS already points at Vercel). The marketing site remains reachable at its `mallet-site.vercel.app` URL; optionally add `www.trymallet.com` back to `mallet-site` later.
- [ ] **Step 5: Stripe webhook** — Stripe dashboard (test mode for pilot) → Webhooks → add endpoint `https://trymallet.com/api/webhooks/stripe`, events: `checkout.session.completed`; copy the real `whsec_` into the `STRIPE_WEBHOOK_SECRET` env var; redeploy.
- [ ] **Step 6: Cron decision** — `vercel.json` already schedules `/api/cron/outbox` every 5 minutes; that requires Vercel Pro. Either upgrade, or change the schedule to daily and stand up an external pinger (POST with `x-cron-secret`) every 5 minutes. Record the choice in the PR description.
- [ ] **Step 7: Prod smoke** — sign up a real throwaway account on trymallet.com (confirm email → welcome → dashboard); create customer → quote → job → invoice → record a manual payment; open `/assistant` and run one read question; log in as a seeded tech (seed via `node --env-file=.env.production scripts/seed-e2e.mjs` variant or manual SQL) and start/complete a job on a phone. Verify `/api/health` and `/api/ready` return 200.
- [ ] **Step 8: Update memory + landing-page note** — mallet-site loses the root domain (waitlist funnel now at the vercel.app URL); decide whether to re-home it to `www.` with Owen.

---

## Plan self-review (performed at write time)

1. **Spec coverage:** decisions table → Tasks 1 (stack/theme), 5-8 (auth+role routing+mobile shells), 3-4 (identity slice §3.1), 17 (field slice §3.2), 11-15 (screens table incl. `customers.get` and `identity.members` consumers), 19 (assistant §4.4), 9/16/20 (test pyramid §5), 21 (deploy §6). Deferred list untouched — no task builds pipeline/tasks/timesheets/messages/invites. ✔
2. **Known verify-at-implementation points (deliberate, single-line checks, not placeholders):** `paymentDTO` field name (Task 14), `summaryDTO.due` presence (Tasks 14/15), `orThrow` import path + use-case ctor args copied from `job-router.ts` (Task 17), `leads` insert guard in the seed script (Task 9).
3. **Type consistency:** `authedNoPrincipal`/`anyRole` (Task 3) match Tasks 4/17; `useMembers` (Task 6) matches Task 13; `LineDraft` (Task 12) self-contained; `VerifiedToken` (Task 3) matches Task 4's test; DTO field names traced from the actual routers. Task 3's mechanical Step 8 must ALSO add `unmapped: null` to every existing int-test `Context` literal (the `Context` interface gained a required field) — included in that step's scope.
4. **Gate placement:** every phase ends with full gate + PR + adversarial review WITH the fix commit landing before merge (Tasks 10, 16, 20; Phase D is ops).



