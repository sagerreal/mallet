export default function Loading() {
  return (
    <div style={{ padding: "0 0 24px" }}>
      {/* Title bar skeleton */}
      <div className="sk-row" style={{ borderBottom: "none", paddingBottom: 20 }}>
        <div className="sk" style={{ width: "40%", height: 24 }} />
      </div>
      {/* Card block 1 */}
      <div className="sk-row">
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="sk" style={{ width: "70%", height: 14 }} />
          <div className="sk" style={{ width: "50%", height: 12 }} />
        </div>
      </div>
      {/* Card block 2 */}
      <div className="sk-row">
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="sk" style={{ width: "60%", height: 14 }} />
          <div className="sk" style={{ width: "45%", height: 12 }} />
        </div>
      </div>
    </div>
  );
}
