import type { ReactNode } from "react";
import { guardRole } from "@/lib/auth/guard";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { CommandBar } from "@/components/shell/command-bar";
import { ModalHost } from "@/components/modals/modal-host";

export const dynamic = "force-dynamic";

export default async function OfficeLayout({ children }: { children: ReactNode }) {
  await guardRole(["owner", "office"]);
  return (
    <div className="appshell">
      <div className="layout">
        <Sidebar />
        <div className="appmain">
          <Topbar />
          <div id="flashbar" />
          <main id="main">
            {children}
          </main>
        </div>
      </div>
      <CommandBar />
      <ModalHost />
    </div>
  );
}
