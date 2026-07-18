/**
 * components/shared/first-run-empty-state.tsx
 * A reusable first-run empty state: a short heading + subtext, then one or more
 * "paths" — a titled card with a description and an action button. PURE and
 * dependency-injected: the caller passes the copy and the onAction callbacks, so
 * this imports no store and no modal system and can be reused by any list page
 * (Customers first; Jobs/Invoices later). Anchored + in-flow (no floating UI).
 */

export interface EmptyStatePath {
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
  /** "primary" gets the emphasized button + a stronger card border; default "ghost". */
  readonly variant?: "primary" | "ghost";
}

export interface FirstRunEmptyStateProps {
  readonly heading: string;
  readonly subtext: string;
  readonly paths: readonly EmptyStatePath[];
}

export function FirstRunEmptyState({ heading, subtext, paths }: FirstRunEmptyStateProps) {
  return (
    <div className="frs">
      <div className="frs-lede">
        <h2 className="frs-heading">{heading}</h2>
        <p className="frs-sub">{subtext}</p>
      </div>
      <div className="frs-paths" data-count={paths.length}>
        {paths.map((path) => (
          <PathCard key={path.title} path={path} />
        ))}
      </div>
    </div>
  );
}

function PathCard({ path }: { path: EmptyStatePath }) {
  const primary = path.variant === "primary";
  return (
    <div className={primary ? "frs-path frs-path-primary" : "frs-path"}>
      <p className="frs-path-title">{path.title}</p>
      <p className="frs-path-desc">{path.description}</p>
      <button type="button" className={primary ? "btn primary" : "btn ghost"} onClick={path.onAction}>
        {path.actionLabel}
      </button>
    </div>
  );
}
