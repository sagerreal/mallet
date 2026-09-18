/**
 * components/shared/list-loading.tsx
 * The quiet cold-load state for list surfaces — shown while the hydrator's first
 * fetch is in flight and the store is still empty (isFirstLoad). Prevents the
 * flash where a shop that HAS data briefly sees its first-run "nothing here yet"
 * screen for ~1s on reload before rows arrive.
 *
 * Renders a shimmer skeleton (the same `.sk`/`.sk-row` primitives the field views
 * use) instead of a "Loading…" line, so the office lists load as premium as the
 * rest of the app. The label stays in a visually-hidden node so screen readers
 * announce it (role="status") and the accessible name is unchanged.
 *
 * Pairs with shouldShowFirstRun (loaded + empty) and shouldShowLoadFailed
 * (errored) — the three are mutually exclusive, one per list state.
 */

export function ListLoading({ rows = 6, label = "Loading…" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="sk-row" aria-hidden="true">
          <div className="sk" style={{ width: "44%", height: 14 }} />
          <div className="sk" style={{ width: "18%", height: 14, marginLeft: "auto" }} />
        </div>
      ))}
    </div>
  );
}
