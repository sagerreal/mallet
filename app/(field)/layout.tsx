import type { ReactNode } from "react";
import { guardRole } from "@/lib/auth/guard";
import { Sidebar } from "@/components/shell/sidebar";
import { MobileTabs } from "@/components/shell/mobile-tabs";
import { Topbar } from "@/components/shell/topbar";
import { CommandBar } from "@/components/shell/command-bar";
import { CallBar } from "@/components/shell/call-bar";
import { ModalHost } from "@/components/modals/modal-host";
import { FieldJobsHydrator } from "@/features/field/field-jobs-hydrator";

export const dynamic = "force-dynamic";

/**
 * The Field shell — the technician's app. Phone-first: no office sidebar, just
 * the top bar, the content, the Ask-Mallet bar, and the field tab bar (My day /
 * My hours / Messages / More). Its guard admits techs (who live ONLY here) plus
 * owner/office (an owner-operator who also works jobs). The office group's guard
 * blocks techs and redirects them here, so a tech can never reach office pages.
 */
export default async function FieldLayout({ children }: { children: ReactNode }) {
  await guardRole(["owner", "office", "tech"]);
  return (
    <div className="appshell field-shell">
      {/* Fills store.jobs from v1.field.myDay — the office JobsHydrator is
          ownerOrOffice-only, so without this a tech's store (and the
          tech-job-modal it feeds) would stay empty. */}
      <FieldJobsHydrator />
      <div className="layout">
        <Sidebar />
        <div className="appmain">
          <Topbar />
          <div id="flashbar" />
          <main id="main">{children}</main>
        </div>
      </div>
      <CommandBar />
      <CallBar />
      <MobileTabs />
      <ModalHost />
    </div>
  );
}
