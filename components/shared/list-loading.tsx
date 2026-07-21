/**
 * components/shared/list-loading.tsx
 * The quiet cold-load state for list surfaces — shown while the hydrator's first
 * fetch is in flight and the store is still empty (isFirstLoad). Prevents the
 * flash where a shop that HAS data briefly sees its first-run "nothing here yet"
 * screen for ~1s on reload before rows arrive.
 *
 * Pairs with shouldShowFirstRun (loaded + empty) and shouldShowLoadFailed
 * (errored) — the three are mutually exclusive, one per list state.
 */

export function ListLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="empty-att" style={{ padding: "var(--space-6) 0" }} aria-busy="true">
      {label}
    </div>
  );
}
