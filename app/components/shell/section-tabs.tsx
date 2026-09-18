"use client";

/**
 * components/shell/section-tabs.tsx
 * Second-level navigation — a top tab bar under the app bar for the sub-views of
 * a section, so a phone can reach them (the bottom bar only carries level-one
 * sections). Customers → Customers · Tasks; Jobs → Jobs · Schedule ·
 * Timesheets. Mobile-only (CSS hides it on desktop, where the sidebar carries the
 * sub-nav). Route-driven — nothing renders on sections without sub-views.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useAppStore } from "@/lib/store/app-store";
import {
  selectCustomerCount,
  selectOpenTaskCount,
  selectSentQuoteCount,
  selectJobsCount,
  selectUnscheduledCount,
} from "@/components/shell/shell-selectors";
import { useNavCounts } from "@/components/shell/use-nav-counts";

interface SecTab {
  href: string;
  label: string;
  active: boolean;
  count?: number;
}

// The customer area's routes are separate pages grouped under "Customers".
const CUSTOMER_AREA = ["/customers", "/tasks", "/quotes"];

export function SectionTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");

  // Primitive selectors — return numbers so referential equality suppresses
  // re-renders when unrelated store slices are written.
  // Database counts, not what the browser loaded — see useNavCounts.
  const navCounts = useNavCounts();
  const customerCount = navCounts.customers ?? 0;
  const openTasks = useAppStore(selectOpenTaskCount);
  const sentQuotes = useAppStore(selectSentQuoteCount);
  const jobsCount = navCounts.jobs ?? 0;
  const unscheduled = useAppStore(selectUnscheduledCount);

  const inCustomers = CUSTOMER_AREA.some((r) => pathname.startsWith(r));
  const inJobs = pathname.startsWith("/jobs");
  const inMoney = pathname.startsWith("/money");

  let tabs: SecTab[] = [];
  if (inCustomers) {
    tabs = [
      { href: "/customers", label: "Customers", active: pathname.startsWith("/customers"), count: customerCount },
      { href: "/quotes", label: "Quotes", active: pathname.startsWith("/quotes"), count: sentQuotes },
      { href: "/tasks", label: "Tasks", active: pathname.startsWith("/tasks"), count: openTasks },
    ];
  } else if (inJobs) {
    tabs = [
      { href: "/jobs", label: "Jobs", active: !tab || (tab !== "schedule" && tab !== "timesheets"), count: jobsCount },
      { href: "/jobs?tab=schedule", label: "Schedule", active: tab === "schedule", count: unscheduled },
      { href: "/jobs?tab=timesheets", label: "Timesheets", active: tab === "timesheets" },
      // No Checklists tab: checklists moved to the Office page in Jul 2026, and /jobs redirects
      // ?tab=checklists straight to /dashboard. Left in the Jobs row it was a tab that threw you
      // out of the section and could never show as active.
    ];
  } else if (inMoney) {
    tabs = [
      // "Getting paid" is gone (Owen: just keep invoices under Money, call orders purchase
      // orders) — /money with no ?tab= IS the invoices ledger, needing no tab of its own.
      // Purchase orders are cash going OUT; every other row in Money is cash coming IN — kept as
      // a separate SET rather than mixed into the receivables ledger, same reasoning the mock
      // (mock/money-purchase-orders) used for its ViewToggle. This is the real tab grammar
      // instead, and on mobile it is the only route to the tab at all (the sidebar's own NavSub
      // — components/shell/sidebar.tsx — is desktop-only).
      { href: "/money?tab=orders", label: "Purchase orders", active: tab === "orders" },
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
