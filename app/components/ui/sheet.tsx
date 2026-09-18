import type { ReactNode } from "react";
import { Button } from "./button";

/** In-flow sheet (not a modal) — a titled card that expands below its trigger. */
export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <section className="card" style={{ marginTop: "var(--space-4)" }}>
      <div className="pagehead" style={{ marginBottom: "var(--space-3)" }}>
        <h3 style={{ fontSize: "var(--type-lg)" }}>{title}</h3>
        <Button variant="quiet" size="sm" onClick={onClose}>Close</Button>
      </div>
      {children}
    </section>
  );
}
