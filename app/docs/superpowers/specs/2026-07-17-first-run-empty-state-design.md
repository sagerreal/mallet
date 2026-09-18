# First-run empty state — design

**Date:** 2026-07-17
**Status:** Approved (design), ready to implement
**Scope:** A reusable first-run empty-state component, wired into the Customers (People) list first. Jobs/Invoices/etc. reuse it later.

## Problem

When a brand-new shop opens **Customers** with zero people, they currently see the full list chrome (toolbar, columns, an empty table with a tiny "Nothing matches — clear the filters" row). There is no first-run guidance and no distinction between "no customers ever" and "filters exclude everything." A first-time user should instead get a clear screen that tells them what this page is for and gives them the two ways to populate it.

## Approved direction (mockup option C — "two paths")

Keep the page header (title + "+ New customer" + sub) **and** the People/Companies tabs. Replace only the toolbar + table with a centered block: a short heading, one line of subtext, and **two path cards**:

- **Add one by hand** (primary) → opens `MODAL.NEW_CUSTOMER`
- **Import a spreadsheet** (ghost) → opens `MODAL.IMPORT_CUSTOMERS`

Both modals already exist and are wired (import is currently only surfaced in Settings). No new modal, endpoint, or migration.

## Components (single responsibility each)

### 1. `FirstRunEmptyState` — pure, dependency-injected presentational component
`components/shared/first-run-empty-state.tsx` (sits alongside `view-toggle.tsx`).

```ts
export interface EmptyStatePath {
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
  readonly variant?: "primary" | "ghost"; // default "ghost"; first path typically "primary"
}

export interface FirstRunEmptyStateProps {
  readonly heading: string;
  readonly subtext: string;
  readonly paths: readonly EmptyStatePath[];
}
```

- **Imports no store and no modal system** — the caller injects `onAction`. This is DI + SRP (renders only), Open/Closed (new callers extend via `paths`, never by editing the component), Interface Segregation (minimal props), and a pure function of props.
- Renders the heading + subtext, then the paths as a responsive grid of bordered cards (`grid-template-columns: 1fr 1fr`, collapsing to one column on narrow screens). Each path card is a small (<20-line) sub-component. First path (or `variant:"primary"`) gets the emphasized `.btn.primary` + a slightly stronger card border; others get `.btn.ghost`.
- No floating UI; cards are anchored/flush and expand in flow. Copy is passed in (functional, not chatty).

### 2. `shouldShowFirstRun` — pure predicate (the "when", separated from the "render")
Small pure function (co-located in `customers-utils.ts`):

```ts
shouldShowFirstRun({ isFetched, isError, count }): boolean
  = isFetched && !isError && count === 0
```

- Makes the **error case explicit — no silent failure**: a *failed* list load is NOT treated as "no customers" (that would wrongly tell a real shop to add their first customer). Only a *successful, empty* load shows first-run.
- Pure → unit-tested in isolation, table-driven.

### 3. `CustomersView` wiring
- Reads the customers-list query's `isFetched`/`isError` via the **same query key the hydrator already uses** (`api.v1.customers.list.useQuery({ limit: HYDRATOR_PAGE_LIMIT }, ...)`), so React Query **dedupes it — no extra network round-trip**.
- "Empty" = **zero leads total** (active **and** archived): `leads.length === 0`. A shop with only archived customers sees the normal list, not first-run.
- Only the People segment shows it (the `custSeg === "biz"` branch already returns `<CompaniesView/>` earlier).
- When `shouldShowFirstRun`, render `<FirstRunEmptyState>` in place of `<CustomersToolbar>` + the table `.card`. The header, sub, and segment tabs stay so Companies remains reachable.
- All copy (heading, subtext, path titles/descriptions/labels) lives in **named constants** at the top of the view — no magic strings.

## Data flow

`LeadsHydrator` (already mounted in the office layout) fetches `v1.customers.list` → writes `leads` to the store. `CustomersView` reads `leads` (store) for the list, and the **same query's** fetch state (deduped) for the load/empty/error distinction. No new data access, no repository/transaction changes.

## Error handling

- List load **error** → `shouldShowFirstRun` is false → the existing view renders (empty table), never the misleading first-run screen. (A dedicated error surface is out of scope; today the hydrator logs the error via `useStoreHydrator`.)
- No silent failures introduced; the component has no failure modes (pure render).

## Testing (test pyramid — unit-heavy, behavior not implementation, Arrange-Act-Assert)

- **Predicate** (`shouldShowFirstRun`): table-driven — loading→false, error→false, fetched+0→true, fetched+N→false.
- **Component** (`FirstRunEmptyState`): renders the heading, subtext, and each path's title/description/label; clicking a path's button fires that path's `onAction`; the primary variant renders the emphasized button.
- **View** (`CustomersView`): shows the empty state when loaded-and-empty; shows the list when populated; shows **neither** while loading or on error (the no-flash / no-false-empty guarantee).
- No E2E for a static screen.

## Out of scope (YAGNI)

Companies-tab first-run; Jobs/Invoices/other pages (the component is built reusable, but only Customers is wired now); a dedicated list-load error UI; any new modal/endpoint/migration. Repository pattern, transaction boundaries, domain validation, rate limiting, API versioning, retries/circuit breakers do not apply — there is no new data access or external call; the two actions open existing, already-validated modals.

## Follow principles

`docs/design-principles.md` (binding). Applied above: DI, SRP, Open/Closed, Interface Segregation, DRY (one component), YAGNI (no unused knobs, no inapplicable patterns), pure functions, small functions, meaningful names, no magic strings, explicit error handling / no silent failure, design-for-testability.
