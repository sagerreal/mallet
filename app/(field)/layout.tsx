import type { ReactNode } from "react";
import { guardRole } from "@/lib/auth/guard";
import { resolveMe } from "@/lib/auth/server-me";
import { resolveFieldToggles } from "@/lib/auth/server-field-toggles";
import { FieldTogglesProvider } from "@/features/settings/field-toggles-provider";
import { Sidebar } from "@/components/shell/sidebar";
import { MobileTabs } from "@/components/shell/mobile-tabs";
import { Topbar } from "@/components/shell/topbar";
import { CommandBar } from "@/components/shell/command-bar";
import { CallBar } from "@/components/shell/call-bar";
import { ModalHost } from "@/components/modals/modal-host";
import { FieldJobsHydrator } from "@/features/field/field-jobs-hydrator";
import { JobsHydrator } from "@/features/jobs/jobs-hydrator";
import { LeadsHydrator } from "@/features/customers/leads-hydrator";
import { InvoicesHydrator } from "@/features/money/invoices-hydrator";
import { SettingsHydrator } from "@/features/settings/settings-hydrator";
import { FieldTogglesHydrator } from "@/features/settings/field-toggles-hydrator";
import { BusinessIdentityHydrator } from "@/features/settings/business-identity-hydrator";
import { DocumentWordingHydrator } from "@/features/settings/document-wording-hydrator";
import { WriteErrorToast } from "@/components/shared/write-error-toast";

/**
 * The Field shell — the technician's app. Phone-first: no office sidebar, just
 * the top bar, the content, the Ask-Mallet bar, and the field tab bar (My day /
 * My hours / Messages / More). Its guard admits techs (who live ONLY here) plus
 * owner/office (an owner-operator who also works jobs). The office group's guard
 * blocks techs and redirects them here, so a tech can never reach office pages.
 *
 * No `dynamic = "force-dynamic"` here: guardRole reads the session cookie, which already makes
 * every field route dynamic — the explicit override added nothing.
 */
export default async function FieldLayout({ children }: { children: ReactNode }) {
  const principal = await guardRole(["owner", "office", "tech"]);
  const isTech = principal.role === "tech";
  // The org's field capability flags are resolved SERVER-SIDE, beside `me`, so the surfaces that
  // change shape on them are right on the FIRST paint instead of appearing (or vanishing) when a
  // hydrator lands: the Quote tab's scan row on `measurement`, the job sheet's Text button on
  // `canText`. One anyRole read carries both, so a tech gets them too.
  // See lib/auth/server-field-toggles.ts.
  const [initialMe, fieldToggles] = await Promise.all([
    resolveMe(principal),
    resolveFieldToggles(principal),
  ]);
  return (
    <FieldTogglesProvider seed={fieldToggles}>
      <div className="appshell field-shell">
        {/* Fills store.jobs from v1.field.myDay — the office JobsHydrator is
            ownerOrOffice-only, so without this a tech's store (and the
            tech-job-modal it feeds) would stay empty. */}
        <FieldJobsHydrator />
        {/* Owner/office on the field surface: FieldJobsHydrator is tech-only (it must not
            replace the office's full lists with a personal subset), so on a COLD load of
            /my-day their store was empty and tapping a job opened a blank modal. Mount the
            office hydrators the shared field components read — jobs (the modal's data
            source), leads (customer name + Call), invoices (the done close-out branches).
            Role is known server-side; techs would only get FORBIDDEN from these queries.

            SettingsHydrator is here for the same reason and one more: it writes store.toggles, and
            the tech job modal's Quote tab gates its "Scan a room" row on
            toggles.measurementEstimating. Without it, a COLD load of /my-day left that toggle
            unhydrated (the store has no persist middleware), so a measuring org's scan entry point
            was invisible on the field surface until the user happened to visit an office route
            first — a feature that appeared or vanished depending on the route you arrived by.
            v1.settings.get is ownerOrOffice, hence the !isTech gate. */}
        {!isTech && (
          <>
            <JobsHydrator />
            <LeadsHydrator />
            <InvoicesHydrator />
            <SettingsHydrator />
          </>
        )}
        {/* …and a TECHNICIAN gets the same capability flag from a read they are allowed to make.
            The office SettingsHydrator above can never run for them (v1.settings.get is
            ownerOrOffice) and they cannot soft-navigate into an office route to get it either —
            the office guard bounces them straight back here. So for a tech
            toggles.measurementEstimating stayed unhydrated for the entire session, and the field
            scan row never rendered on the one surface built for the field. v1.settings.fieldToggles
            is anyRole and returns ONE boolean — no office configuration crosses over. Exactly one
            of the two hydrators mounts, so they never race to write the same key. */}
        {isTech && <FieldTogglesHydrator />}
        {/* EVERY role here, unlike the block above: the close-out sheet a technician turns around
            at the door is the customer's own copy of the bill, and it printed no address, no phone
            and no licence. v1.settings.businessIdentity is anyRole for exactly this. */}
        <BusinessIdentityHydrator />
        {/* The org's document wording (invoice footer + change-order agreement line) — the same
            argument as businessIdentity: the close-out and the CO sign screen show these sentences
            to a customer, and v1.settings.documentWording is anyRole for exactly this. */}
        <DocumentWordingHydrator />
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
    </FieldTogglesProvider>
  );
}
