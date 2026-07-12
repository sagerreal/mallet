"use client";

/**
 * A small warm-tinted rounded square that anchors a settings "action card" body with an icon,
 * giving the Ways-leads-reach-you cards a consistent visual language instead of a lone button.
 */
export function IconWell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        background: "var(--manila)",
        border: "1px solid var(--manila-line)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--ink-2)",
      }}
    >
      {children}
    </div>
  );
}
