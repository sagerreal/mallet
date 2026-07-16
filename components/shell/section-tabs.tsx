"use client";

/**
 * components/shell/section-tabs.tsx
 * Second-level navigation — a top tab bar under the app bar for the sub-views of
 * a section, so a phone can reach them (the bottom bar only carries level-one
 * sections). Customers → Customers · Pipeline · Tasks; Jobs → Jobs · Schedule ·
 * Timesheets. Mobile-only (CSS hides it on desktop, where the sidebar carries the
 * sub-nav). Route-driven — nothing renders on sections without sub-views.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useAppStore } from "@/lib/store/app-store";
import {
  selectCustomerCount,
  selectOpenTaskCount,
  selectJobsCount,
  selectUnscheduledCount,
} from "@/components/shell/shell-selectors";

interface SecTab {
  href: string;
  label: string;
  active: boolean;
  count?: number;
}

// The customer area's routes are separate pages grouped under "Customers".
const CUSTOMER_AREA = ["/customers", "/pipeline", "/tasks"];

export function SectionTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");

  // Primitive selectors — return numbers so referential equality suppresses
  // re-renders when unrelated store slices are written.
  const customerCount = useAppStore(selectCustomerCount);
  const openTasks = useAppStore(selectOpenTaskCount);
  const jobsCount = useAppStore(selectJobsCount);
  const unscheduled = useAppStore(selectUnscheduledCount);

  const inCustomers = CUSTOMER_AREA.some((r) => pathname.startsWith(r));
  const inJobs = pathname.startsWith("/jobs");

  let tabs: SecTab[] = [];
  if (inCustomers) {
    tabs = [
      { href: "/customers", label: "Customers", active: pathname.startsWith("/customers"), count: customerCount },
      { href: "/pipeline", label: "Pipeline", active: pathname.startsWith("/pipeline") },
      { href: "/tasks", label: "Tasks", active: pathname.startsWith("/tasks"), count: openTasks },
    ];
  } else if (inJobs) {
    tabs = [
      { href: "/jobs", label: "Jobs", active: !tab || (tab !== "schedule" && tab !== "timesheets" && tab !== "checklists"), count: jobsCount },
      { href: "/jobs?tab=schedule", label: "Schedule", active: tab === "schedule", count: unscheduled },
      { href: "/jobs?tab=timesheets", label: "Timesheets", active: tab === "timesheets" },
      { href: "/jobs?tab=checklists", label: "Checklists", active: tab === "checklists" },
    ];
  }

  if (tabs.length === 0) return null;

  return (
    <nav className="sectiontabs" aria-label="Section">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className={`sectiontab${t.active ? " on" : ""}`} aria-current={t.active ? "page" : undefined}>
          {t.label}
          {t.count ? <span className="n mono">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
