import type { ReactNode } from "react";

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header className="mb-4 flex items-center justify-between">
      <h1 className="font-display text-xl font-semibold">{title}</h1>
      {action ?? null}
    </header>
  );
}
