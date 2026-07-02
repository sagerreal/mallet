import type { ReactNode } from "react";
import { guardRole } from "@/lib/auth/guard";
import { SignOutButton } from "@/components/shell/sign-out-button";

export const dynamic = "force-dynamic";

export default async function FieldLayout({ children }: { children: ReactNode }) {
  await guardRole(["tech", "owner", "office"]); // techs live here; office roles may preview
  return (
    <div className="mx-auto min-h-dvh max-w-md">
      <header className="flex items-center justify-between border-b border-line p-4">
        <p className="font-display text-lg font-semibold">Mallet</p>
        <SignOutButton />
      </header>
      <main className="p-4">{children}</main>
    </div>
  );
}
