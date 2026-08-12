import type { ReactNode } from "react";
import { guardRole } from "@/lib/auth/guard";
import { resolveMe } from "@/lib/auth/server-me";
import { resolveFieldToggles } from "@/lib/auth/server-field-toggles";
import { FieldTogglesProvider } from "@/features/settings/field-toggles-provider";
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
import { CompaniesHydrator } from "@/features/customers/companies-hydrator";
import { ChecklistsHydrator } from "@/features/checklists/checklists-hydrator";
import { SettingsHydrator } from "@/features/settings/settings-hydrator";
import { PricebookHydrator } from "@/features/pricebook/pricebook-hydrator";
import { AssembliesHydrator } from "@/features/pricebook/assemblies-hydrator";
import { BrandHydrator } from "@/features/settings/brand-hydrator";
import { BusinessIdentityHydrator } from "@/features/settings/business-identity-hydrator";
import { DocumentWordingHydrator } from "@/features/settings/document-wording-hydrator";
import { A2pHydrator } from "@/features/a2p/a2p-hydrator";
import { WriteErrorToast } from "@/components/shared/write-error-toast";

export const dynamic = "force-dynamic";

export default async function OfficeLayout({ children }: { children: ReactNode }) {
  const principal = await guardRole(["owner", "office"]);
  // Both resolved on the principal the guard already produced. The measurement gate is seeded
  // SERVER-SIDE for the same reason `me` is: it decides whether the composer's Measure card is on
  // screen at all, and a client-only read paints the card first and deletes it a beat later for
  // every non-measuring shop. See lib/auth/server-field-toggles.ts. The one read also carries
  // `canText`; nothing in the office reads it today (A2pHydrator covers the desk), but it is
  // seeded here too rather than branching the provider on which shell you are in.
  const [initialMe, fieldToggles] = await Promise.all([
    resolveMe(principal),
    resolveFieldToggles(principal),
  ]);
  return (
    <FieldTogglesProvider seed={fieldToggles}>
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
        <CompaniesHydrator />
        <ChecklistsHydrator />
        <SettingsHydrator />
        <PricebookHydrator />
        <AssembliesHydrator />
        <BrandHydrator />
        {/* The shop's address/phone/email/licence — what the customer's invoice prints under the
            brand. Its own hydrator (not BrandHydrator's) because the FIELD shell needs the same
            facts from an anyRole read; one writer, both shells. */}
        <BusinessIdentityHydrator />
        {/* The org's document wording (invoice footer + change-order agreement line) — same
            one-writer-both-shells shape as BusinessIdentityHydrator. */}
        <DocumentWordingHydrator />
        <A2pHydrator />
      </div>
    </FieldTogglesProvider>
  );
}
