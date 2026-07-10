import type { ReactNode } from "react";
import { guardRole } from "@/lib/auth/guard";
import { Sidebar } from "@/components/shell/sidebar";
import { MobileTabs } from "@/components/shell/mobile-tabs";
import { SectionTabs } from "@/components/shell/section-tabs";
import { Topbar } from "@/components/shell/topbar";
import { CommandBar } from "@/components/shell/command-bar";
import { CallBar } from "@/components/shell/call-bar";
import { ModalHost } from "@/components/modals/modal-host";
import { LeadsHydrator } from "@/features/customers/leads-hydrator";
import { JobsHydrator } from "@/features/jobs/jobs-hydrator";
import { TechsHydrator } from "@/features/team/techs-hydrator";
import { EstimatesHydrator } from "@/features/quotes/estimates-hydrator";
import { InvoicesHydrator } from "@/features/money/invoices-hydrator";
import { TasksHydrator } from "@/features/tasks/tasks-hydrator";
import { TimesheetsHydrator } from "@/features/timesheets/timesheets-hydrator";
import { CompaniesHydrator } from "@/features/customers/companies-hydrator";
import { SettingsHydrator } from "@/features/settings/settings-hydrator";

export const dynamic = "force-dynamic";

export default async function OfficeLayout({ children }: { children: ReactNode }) {
  await guardRole(["owner", "office"]);
  return (
    <div className="appshell">
      <div className="layout">
        <Sidebar />
        <div className="appmain">
          <Topbar />
          <SectionTabs />
          <div id="flashbar" />
          <main id="main">
            {children}
          </main>
        </div>
      </div>
      <CommandBar />
      <CallBar />
      <MobileTabs />
      <ModalHost />
      <LeadsHydrator />
      <JobsHydrator />
      <TechsHydrator />
      <EstimatesHydrator />
      <InvoicesHydrator />
      <TasksHydrator />
      <TimesheetsHydrator />
      <CompaniesHydrator />
      <SettingsHydrator />
    </div>
  );
}
