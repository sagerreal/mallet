"use client";

/**
 * Jobs page — the router shell for the three Jobs sub-views. The sidebar nav
 * drives which one shows via ?tab= (jobs | schedule | timesheets); each view is
 * its own feature module that reads the live store and owns its own state:
 *   • JobsHome       — the banded ledger (features/jobs/jobs-home)
 *   • SchedulePanel  — the crew × hour dispatch board (features/jobs/schedule-panel)
 *   • TimesheetsPanel— the crew week timesheets (features/jobs/timesheets-panel)
 */

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { JobsHome } from "@/features/jobs/jobs-home";
import { SchedulePanel } from "@/features/jobs/schedule-panel";
import { TimesheetsPanel } from "@/features/jobs/timesheets-panel";

type JobsSubTab = "jobs" | "schedule" | "timesheets";

const JOBS_TABS: readonly JobsSubTab[] = ["jobs", "schedule", "timesheets"];

export default function JobsPage() {
  const openModal = useOpenModal();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get("tab");
  const router = useRouter();
  // Checklists moved to the Office page (Jul 2026) — old links follow it.
  useEffect(() => {
    if (tabParam === "checklists") router.replace("/dashboard?tab=checklists");
  }, [tabParam, router]);
  const activeTab: JobsSubTab = JOBS_TABS.includes(tabParam as JobsSubTab)
    ? (tabParam as JobsSubTab)
    : "jobs";

  const handleOpenJob = (id: string) => openModal(MODAL.JOB, { jobId: id });
  const handleOpenNewJob = () => openModal(MODAL.NEW_JOB);

  return (
    <div>
      {activeTab === "jobs" && <JobsHome onOpenJob={handleOpenJob} onOpenNewJob={handleOpenNewJob} />}
      {activeTab === "schedule" && <SchedulePanel />}
      {activeTab === "timesheets" && <TimesheetsPanel />}
    </div>
  );
}
