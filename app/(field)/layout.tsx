import type { ReactNode } from "react";
import { guardRole } from "@/lib/auth/guard";
import { resolveMe } from "@/lib/auth/server-me";
import { Sidebar } from "@/components/shell/sidebar";
import { MobileTabs } from "@/components/shell/mobile-tabs";
import { Topbar } from "@/components/shell/topbar";
import { CommandBar } from "@/components/shell/command-bar";
import { CallBar } from "@/components/shell/call-bar";
import { ModalHost } from "@/components/modals/modal-host";
import { FieldJobsHydrator } from "@/features/field/field-jobs-hydrator";
import { WriteErrorToast } from "@/components/shared/write-error-toast";

export const dynamic = "force-dynamic";

/**
 * The Field shell — the technician's app. Phone-first: no office sidebar, just
 * the top bar, the content, the Ask-Mallet bar, and the field tab bar (My day /
 * My hours / Messages / More). Its guard admits techs (who live ONLY here) plus
 * owner/office (an owner-operator who also works jobs). The office group's guard
 * blocks techs and redirects them here, so a tech can never reach office pages.
 */
export default async function FieldLayout({ children }: { children: ReactNode }) {
  const principal = await guardRole(["owner", "office", "tech"]);
  const isTech = principal.role === "tech";
  const initialMe = await resolveMe(principal);
  return (
    <div className="appshell field-shell">
      {/* Fills store.jobs from v1.field.myDay — the office JobsHydrator is
          ownerOrOffice-only, so without this a tech's store (and the
          tech-job-modal it feeds) would stay empty. */}
      <FieldJobsHydrator />
      <div className="layout">
        <Sidebar initialMe={initialMe} />
        <div className="appmain">
          <Topbar />
          <div id="flashbar" />
          <main id="main">{children}</main>
          <WriteErrorToast />
        </div>
      </div>
      {/* The office Ask-Mallet bar runs v1.ai.run (ownerOrOffice) — a dead, erroring control
          for techs. Techs get the job-pinned Copilot in the job modal instead; office/owner
          users visiting the field surface keep the bar. */}
      {!isTech && <CommandBar />}
      <CallBar />
      <MobileTabs initialMe={initialMe} />
      <ModalHost />
    </div>
  );
}
