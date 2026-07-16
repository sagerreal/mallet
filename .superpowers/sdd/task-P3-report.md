# Task P3 Report — Payload + Query Hygiene

Date: 2026-07-16

## 1. Modal Chunk — BEFORE / AFTER

### BEFORE (static import, shared first-load bundle)

| Chunk | Raw | Gzip | Note |
|-------|-----|------|------|
| `1thdsdtux5kc7.js` | 261,417 B | 65,257 B | Contains all 22 modal components (identified by `tjclock` string) |

All 22 modal components were in a single chunk that was part of the shared first-load bundle.

### AFTER (dynamic import, deferred lazy chunks)

| Chunk | Raw | Gzip | Note |
|-------|-----|------|------|
| `3brryzejttc6m.js` | 21,412 B | 6,360 B | Thin host — `next/dynamic` stubs + `ModalHost` shell only |
| `1326-4ptp6e-m.js` | 46,593 B | — | Lazy modal chunk (loaded on first modal open) |
| `20ju_np6r9vw2.js` | 10,479 B | — | Lazy modal chunk |
| `41fp0m371m-t4.js` | 23,699 B | — | Lazy modal chunk |

**Old chunk `1thdsdtux5kc7.js` is gone from the build entirely.** The modal content is
now split across separate lazy chunks loaded on demand (first open of a modal in the session).

**Shared first-load savings: ~240KB raw / ~59KB gzip removed from the initial payload.**

## 2. refetchOnWindowFocus Fixes

| File | Before | After |
|------|--------|-------|
| `app/(field)/my-day/page.tsx` | missing (`staleTime: 30_000` only) | `refetchOnWindowFocus: false` added |
| `app/(field)/my-hours/page.tsx` | missing (`staleTime: 60_000` only) | `refetchOnWindowFocus: false` added |
| `app/(field)/messages/page.tsx` (`CustomerInbox`) | already `false` | unchanged (correct) |

## 3. Skeletons Replacing "Loading…" Text

All skeleton states use `.sk` and `.sk-row` primitives from P1's prototype.css.
Box metrics match the real content rows to prevent layout shift on data arrival.

| File | Before | After |
|------|--------|-------|
| `app/(field)/my-day/page.tsx` | `<div className="muted">Loading…</div>` | 3× `.sk-row` with 44px round avatar + 60%/40% bars |
| `app/(field)/my-hours/page.tsx` | `<div className="muted">Loading…</div>` | 3× `.sk-row` with 44px round avatar + 60%/40% bars |
| `app/(field)/messages/page.tsx` (`CustomerInbox`) | `<div className="empty-att">Loading…</div>` | 3× `.sk-row` with 38px round avatar (matches `.javatar` 38px) + 60%/40% bars |
| `app/(office)/loading.tsx` | `<p className="p-6 text-sm text-ink-muted">Loading…</p>` | Title bar skeleton + 2 card blocks |
| `app/(office)/jobs/[id]/page.tsx` | `<p className="text-sm text-ink-muted">Loading…</p>` | Title bar skeleton + 2 card blocks |

### Skeleton dimensions rationale

- **my-day job row**: `.md-stop` uses flex with `.md-time` (40px wide) + `.md-body`.
  Used 44px circle (matching avatar-like indicator) + two bars at 60%/40% width,
  14px/12px height matching `md-line1` bold text and `md-sub` secondary text.
- **my-hours entry row**: `.ts-e` uses flex with kind badge + label + time + hours.
  Same 3-row treatment — 44px avatar standin + two bars.
- **messages conversation row**: `.msg-row` uses `.javatar` at 38px. Skeleton uses
  exactly 38px circle to match the real avatar.
- **office loading + jobs/[id]**: `PageHeader` renders an `<h1>`-equivalent (approx 24px
  tall). Two card blocks with 14px/12px bar pairs to represent the status card and
  action card.

## 4. Gate Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors (170 pre-existing warnings, none from P3 changes) |
| `npm test` | 254 test files, 2821 tests — all pass |
| `npm run build` | Success |

## 5. Concerns / Notes

- **Modal chunk not eliminated entirely** — the content is split across multiple lazy
  chunks (~80KB total across 3+). This is expected: Turbopack splits by import graph,
  so some shared dependencies (store hooks, tRPC, form primitives) may appear in a
  shared split chunk alongside modal content. The key outcome is confirmed: the old
  single 261KB first-load chunk is gone.
- **No flash-of-nothing risk** — `{ ssr: false }` + no `loading:` prop means dynamic
  components render `null` until the chunk loads. Since modals open on interaction
  (not page paint), the chunk is fetched during the user gesture, so the experience is
  identical to before: the `Modal` wrapper controls open/closed state.
- **`LeadModal` and `NewCustomerModal`** — these two modals manage their own `Modal`
  wrapper internally (not wrapped by the host's `<Modal>`). The dynamic import wraps
  them identically — the `open` prop still passes through correctly.
