import type { ReactNode } from "react";
import { Button } from "./button";

export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <section className="mt-4 rounded-card border border-line bg-card p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-base font-semibold">{title}</h2>
        <Button variant="quiet" onClick={onClose}>Close</Button>
      </header>
      {children}
    </section>
  );
}
