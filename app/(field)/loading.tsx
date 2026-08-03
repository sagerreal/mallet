/**
 * The (field) route group's loading state. Every field route is dynamic (the layout's guard reads
 * the session cookie), so without this file a tab tap painted NOTHING until the server responded —
 * the dominant "the field app feels slow" complaint. Mirrors the (office) skeleton: title bar plus
 * two card rows, tokens only.
 */
export default function Loading() {
  return (
    <div style={{ padding: "0 0 var(--space-6)" }}>
      {/* Title bar skeleton */}
      <div className="sk-row" style={{ borderBottom: "none", paddingBottom: "var(--space-5)" }}>
        <div className="sk" style={{ width: "40%", height: 24 }} />
      </div>
      {/* Card block 1 */}
      <div className="sk-row">
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div className="sk" style={{ width: "70%", height: 14 }} />
          <div className="sk" style={{ width: "50%", height: 12 }} />
        </div>
      </div>
      {/* Card block 2 */}
      <div className="sk-row">
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div className="sk" style={{ width: "60%", height: 14 }} />
          <div className="sk" style={{ width: "45%", height: 12 }} />
        </div>
      </div>
    </div>
  );
}
