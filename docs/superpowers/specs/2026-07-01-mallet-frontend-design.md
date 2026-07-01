# Mallet Web App Frontend — Design Spec

- **Date:** 2026-07-01
- **Status:** Approved design (Owen, in-session); feeds the implementation plan
- **Outcome:** A deployed, working web app at **trymallet.com** — login → role-routed app — wired to the existing `trpc.v1` backend on `main`. The prototype (`elas-crm-prototype.html`) is the behavior + visual reference; only backend-backed screens are built.

## 1. Decisions (locked with Owen)

| Decision | Choice |
|---|---|
| Domain | **The app replaces trymallet.com.** `/` redirects: authed → app, unauthed → `/login`. The marketing site (mallet-site repo) stays deployed at its `*.vercel.app` URL; optionally re-homed to `www.trymallet.com` later. |
| Role model | **Role determines the view — no toggle.** `tech` → field view ONLY. `owner`/`office` → office app. Role comes from `v1.identity.me` (server-resolved Principal), never client state. |
| Mobile | **Mobile-first throughout.** Field view designed phone-first; every office screen responsive (tables collapse to cards; sidebar becomes bottom tabs). |
| Auth | **Email + password** via Supabase Auth (`@supabase/ssr`, cookie session). Forgot-password included. Email confirmation ON (secure default; Supabase built-in SMTP for pilot, switch to Resend SMTP when the domain is verified). |
| Stack | **Next.js (existing repo) + Tailwind CSS v4 + copy-in primitives.** NO react-native-web/NativeWind/RN-Reusables in the web app (they tax the pilot: client-components-everywhere, heavier bundles, RN styling subset). NativeWind + RN Reusables are the Phase-6 Expo field-app stack, which consumes the same `trpc.v1` (the create-t3-turbo sharing shape: shared API, not shared UI). |
| Portability hedges | Theme = CSS custom-property tokens (NativeWind-consumable later); primitives are copy-in with RN-Reusables-compatible naming; all data logic in `features/*/hooks` separated from presentation. |
| Data fetching | Client-side React Query via `@trpc/react-query` (both already in package.json). No SSR data fetching in v1 — one auth path, less plumbing. Server components render static shells only. |

## 2. What exists (consume, don't rebuild)

`trpc.v1` routers on main: `customers` (ensure/create, list), `quoting` (draft/get/list/send/accept/decline), `jobs` (scheduleDirect/createFromEstimate/get/list/listByLead/schedule/assign/start/complete/cancel — ALL ownerOrOffice today), `invoicing` (draft/createFromJob/send/recordPayment/void/list + `createPayment` → Stripe hosted-checkout URL), `notifications` (send/list/reminders), `ai` (`run`/`resume` — the agent loop; returns `completed | needs_approval | refused`, with `pending[]` + opaque `transcript` for resume). Auth: Bearer token on every request → `SupabaseAuthProvider` → Principal. RLS enforces tenancy below everything.

## 3. Gaps this project must fill (two small backend slices, same 5-layer pattern)

### 3.1 Identity onboarding + `me`
Nobody can currently get an org. New `v1.identity` router:

- **`v1.identity.signup`** — mutation `{ orgName: string }`. Runs on a new **`authedNoPrincipal`** procedure: verifies the Supabase Bearer token (extend `TokenVerifier.verify` to return `{ authUserId, email }` — additive), but does NOT require an existing Principal. Calls a new **SECURITY DEFINER** function (the established narrow-seam pattern, like `app_resolve_principal`): `app_signup_create_org(p_auth_user_id uuid, p_email text, p_org_name text) returns table (org_id uuid)` — idempotent: if a `users` row exists for `auth_user_id`, return its org; else create org + `users` row (role `owner`) atomically. REVOKE PUBLIC / GRANT `mallet_app`. Migration + RLS untouched elsewhere.
- **`v1.identity.me`** — query, any authenticated role. Returns `{ role, orgId, orgName, email }` (org name read under `withTenant`). This is what the shell routes on.
- **`v1.identity.members`** — query, `ownerOrOffice`. Lists the org's users `{ id, email, role }` under `withTenant` — needed by Jobs → Assign (there is no team-invite flow in v1; additional members are seeded directly, e.g. the E2E tech user).

### 3.2 Field (tech) surface
All jobs procedures are `ownerOrOffice`; techs can call nothing. New **`v1.field`** router (in the jobs module — `modules/jobs/api/field-router.ts`), on a new **`anyRoleOrgTx`** procedure (owner|office|tech + orgTx):

- **`v1.field.myDay`** — query: jobs where `assignee_user_id = principal.userId` and status in (`scheduled`,`in_progress`), ordered by `scheduled_start`. Reuses `ListJobsUseCase` with the assignee filter.
- **`v1.field.start` / `v1.field.complete`** — mutations `{ jobId }`. Reuse `StartJobUseCase`/`CompleteJobUseCase` **plus an assignee guard**: when `principal.role === 'tech'`, the job's `assigneeUserId` must equal `principal.userId` (clean FORBIDDEN otherwise). Owner/office pass without the guard (they already have the office procedures; allowing them here keeps one code path for the field UI).

Existing `ownerOrOffice` procedures are untouched (Open/Closed).

## 4. Frontend architecture

### 4.1 Route groups & shells
```
app/
  (auth)/login/page.tsx            # email+password sign in
  (auth)/signup/page.tsx           # account + org name → supabase signUp → v1.identity.signup
  (auth)/forgot-password/page.tsx  # supabase resetPasswordForEmail + update flow
  (office)/layout.tsx              # sidebar (desktop) / bottom-tab (mobile) shell; guards role ∈ {owner, office}
  (office)/dashboard/page.tsx
  (office)/customers/page.tsx      # + [id]/page.tsx detail
  (office)/quotes/page.tsx         # + new/page.tsx composer + [id]/page.tsx
  (office)/jobs/page.tsx           # + [id]/page.tsx
  (office)/money/page.tsx          # invoices + payments  + [id]/page.tsx
  (office)/assistant/page.tsx      # agent chat with approval cards
  (office)/settings/page.tsx
  (field)/my-day/page.tsx          # tech home: assigned jobs
  (field)/my-day/[id]/page.tsx     # job detail: start / complete
  page.tsx                         # `/` → redirect by session + role
```
- Root `page.tsx` + middleware (`@supabase/ssr` pattern): no session → `/login`; session → fetch `me` → `tech` → `/my-day`, else `/dashboard`. Each shell layout re-asserts the role server-side (defense in depth; the backend enforces regardless).
- `(office)` and `(field)` each get `error.tsx` + `loading.tsx` boundaries.

### 4.2 Data layer
- `lib/supabase/` — browser + server clients (`@supabase/ssr`), middleware session refresh.
- `lib/trpc/` — `createTRPCReact<AppRouter>`, `httpBatchLink({ url: "/api/trpc", headers: async () => ({ authorization: `Bearer ${session.access_token}` }) })`, QueryClient provider (client layout). AppRouter type imported from `@/trpc/root` — full end-to-end types, zero codegen.
- `features/<domain>/hooks.ts` — one hook file per domain wrapping trpc queries/mutations (e.g. `useCustomers`, `useDraftQuote`, `useRecordPayment`, `useAgentTurn`). Presentation components consume hooks only.
- Mutations invalidate the relevant list queries; optimistic updates only where trivially safe (none required for v1).

### 4.3 Design system
- `app/globals.css` — Tailwind v4 + `@theme` tokens ported from the prototype's warm Mallet palette (surface, ink, muted, accent, success/warn/danger, radius, spacing scale). Tokens are CSS custom properties (portable to NativeWind later).
- `components/ui/` — copy-in primitives (~8): `Button`, `Card`, `Input`, `Select`, `Badge`, `Table` (collapses to cards below `sm:`), `Sheet` (in-flow expansion — **no floating UI**, per standing rule), `EmptyState`. Each < 100 lines, props-driven, RN-Reusables-compatible naming.
- Copy is functional, not chatty (standing rule). Money always integer cents → one `formatMoney` util. Dates via one `formatDate` util.

### 4.4 Screens (v1 scope — backend-backed only)
| Screen | Backing | Core interactions |
|---|---|---|
| Dashboard | jobs.list, invoicing.list, customers.list | Today's jobs, unpaid invoices (due), newest customers; each links into its module |
| Customers | customers.* | List (paginated), create (name/phone), detail with quotes+jobs (quoting.list filter, jobs.listByLead) |
| Quotes | quoting.* | List by status; composer (lead picker, line items, tax/deposit bps); send/accept/decline from detail |
| Jobs | jobs.*, identity.members | Status-grouped day list; schedule-from-estimate; assign (picker fed by `identity.members`), reschedule, cancel; NOT a drag-drop calendar in v1 |
| Money | invoicing.* | Invoice list + detail (lines, payments, due); create-from-job; send; record manual payment (method picker); void; "Take card payment" → `createPayment` hosted URL |
| Assistant | ai.run/resume | Chat thread; `needs_approval` renders pending tool calls as approve/deny cards → `resume` with approved ids; `refused` rendered honestly; PRECONDITION_FAILED (no key) → clear empty state |
| Settings | identity.me | Org + account info, sign out |
| My Day (field) | field.* | Assigned jobs (today-first), detail, Start/Complete with big touch targets |

Deferred (no backend): pipeline board, companies, tasks, quote-composer AI drafting UI, timesheets, messages, team invites, notifications bell.

### 4.5 Error handling
- TRPCError code → user-readable copy at one seam (`lib/trpc/error-map.ts`): UNAUTHORIZED → session refresh/login; FORBIDDEN → "your role can't do that"; PRECONDITION_FAILED → feature-not-configured explanation; TOO_MANY_REQUESTS/BAD_GATEWAY (agent) → retry affordance; fallback → generic + request id if present. No raw messages from unexpected errors.
- Route-group error boundaries catch render failures; loading boundaries for suspense.
- Forms validate client-side with minimal local Zod mirrors of the router DTOs (the routers define their input schemas inline and don't export them; mirrors live next to each feature's hooks and cover only user-typed fields). The server remains the authority.

## 5. Testing (pyramid)
- **Unit (many):** the two backend slices TDD'd like every slice (signup idempotency, me, assignee guard); frontend pure logic (error-map, formatters, hooks' input mapping) with Vitest; primitives with @testing-library/react where they carry logic (Table collapse, Sheet behavior).
- **Integration (some):** `identity.int.test.ts` (signup creates org+user idempotently against live RLS; me returns them), `field.int.test.ts` (tech sees only own jobs; start/complete assignee-guarded; foreign tech FORBIDDEN).
- **E2E (few, Playwright):** golden path — signup → create customer → draft quote → accept → job from estimate → invoice from job → record payment; tech path — login as tech → My Day → start → complete; agent path — ask → approval card → approve → result. Runs against local dev + seeded org; CI-tagged smoke subset.

## 6. Deploy & cutover
1. Vercel project for `mallet-app` (repo already on GitHub). Preview deploys per PR from day one.
2. Env vars: Supabase URL/anon/service-role + `APP_DATABASE_URL`/`DATABASE_URL`, `PUBLIC_APP_URL=https://trymallet.com`, Stripe keys + **prod `whsec_` from the Stripe dashboard endpoint**, Resend/EMAIL_FROM (when domain verified), `ANTHROPIC_API_KEY`, `CRON_SECRET`. **All rotated first** (the pasted-in-chat set is burned — rotation is a cutover gate).
3. Supabase Auth config: site URL + redirect URLs for trymallet.com; email confirmation ON.
4. Domain: move `trymallet.com` from the mallet-site Vercel project to the app project. Marketing site remains at its vercel.app URL (re-home to `www.` later if wanted).
5. Cron: `vercel.json` already schedules `/api/cron/outbox` every 5 min — needs Vercel Pro (Hobby = daily). Decision at cutover: Pro, or an external pinger hitting the POST endpoint with the secret.
6. SMS stays off (env-flagged by absent Twilio vars) until Twilio exits trial; email real once Resend domain verified.
7. Post-cutover smoke: E2E golden path against production with a throwaway org.

## 7. Execution shape
Four sequential phases, each a PR with the full gate (typecheck, lint, unit, int, coverage, build) + adversarial review **landed before merge**:
- **A — Foundation:** deps, tokens + primitives, auth screens, identity slice (3.1), shells + role routing, Vercel preview, Playwright harness.
- **B — Office core:** customers, quotes, jobs, money, dashboard.
- **C — Assistant + field:** agent chat with approvals, field slice (3.2) + My Day, settings.
- **D — Cutover:** prod env, domain move, Stripe webhook, cron decision, prod smoke.

## 8. Risks
- **Supabase built-in SMTP rate limits** (~4 emails/hr/address) can bite signup testing → use pre-confirmed test users in E2E; switch SMTP to Resend when domain verified.
- **Session ↔ Bearer drift:** token refresh must propagate to the tRPC link (read session per-request, never cache the token).
- **Marketing funnel goes dark on the root domain** at cutover (accepted; waitlist/Calendly remain on the vercel.app URL until re-homed).
- **Coverage thresholds** apply to a growing UI codebase — keep UI logic in testable pure modules; presentational `.tsx` excluded like infra (mirror the existing coverage-exclude convention).
