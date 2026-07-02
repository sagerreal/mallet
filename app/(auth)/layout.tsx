import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <p className="mb-4 text-center font-display text-2xl font-semibold">Mallet</p>
        {children}
      </div>
    </main>
  );
}
