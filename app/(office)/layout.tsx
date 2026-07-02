import type { ReactNode } from "react";
import { guardRole } from "@/lib/auth/guard";
import { OfficeNav } from "@/components/shell/office-nav";

export const dynamic = "force-dynamic";

export default async function OfficeLayout({ children }: { children: ReactNode }) {
  await guardRole(["owner", "office"]);
  return (
    <div className="flex min-h-dvh">
      <OfficeNav />
      <main className="min-w-0 flex-1 p-4 pb-20 md:p-6 md:pb-6">{children}</main>
    </div>
  );
}
