import type { ReactNode } from "react";
import { guardRole } from "@/lib/auth/guard";
import { resolveMe } from "@/lib/auth/server-me";
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
import { ChecklistsHydrator } from "@/features/checklists/checklists-hydrator";
import { SettingsHydrator } from "@/features/settings/settings-hydrator";
import { PricebookHydrator } from "@/features/pricebook/pricebook-hydrator";
import { BrandHydrator } from "@/features/settings/brand-hydrator";
import { A2pHydrator } from "@/features/a2p/a2p-hydrator";
import { WriteErrorToast } from "@/components/shared/write-error-toast";

export const dynamic = "force-dynamic";

export default async function OfficeLayout({ children }: { children: ReactNode }) {
  const principal = await guardRole(["owner", "office"]);
  const initialMe = await resolveMe(principal);
  return (
    <div className="appshell">
      <div className="layout">
        <Sidebar initialMe={initialMe} />
        <div className="appmain">
          <Topbar />
          <SectionTabs />
          <div id="flashbar" />
          <main id="main">
            {children}
          </main>
          <WriteErrorToast />
        </div>
      </div>
      <CommandBar />
      <CallBar />
      <MobileTabs initialMe={initialMe} />
      <ModalHost />
      <LeadsHydrator />
      <JobsHydrator />
      <TechsHydrator />
      <EstimatesHydrator />
      <InvoicesHydrator />
      <TasksHydrator />
      <TimesheetsHydrator />
      <CompaniesHydrator />
      <ChecklistsHydrator />
      <SettingsHydrator />
      <PricebookHydrator />
      <BrandHydrator />
      <A2pHydrator />
    </div>
  );
}
