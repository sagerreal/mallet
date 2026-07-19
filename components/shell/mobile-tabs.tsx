"use client";

/**
 * components/shell/mobile-tabs.tsx
 * The bottom tab bar for phones — replaces the desktop sidebar below the mobile
 * breakpoint (CSS hides one, shows the other). Route-aware: on a FIELD route
 * (/my-day, /my-hours, /messages) it shows the tech tabs (My day · My hours ·
 * Messages); everywhere else the office tabs (Home · Customers · Jobs · Money ·
 * Settings). Count badges read the same store the sidebar + pages do, in sync.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppStore } from "@/lib/store/app-store";
import { useMe } from "@/features/identity/hooks";
import type { RouterOutputs } from "@/lib/trpc/client";
import { selectCustomerCount, selectJobsCount, selectMoneyCount } from "@/components/shell/shell-selectors";

const HomeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);
const PeopleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const JobsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="20" height="14" rx="2" />
    <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
    <line x1="12" y1="12" x2="12" y2="16" />
    <line x1="10" y1="14" x2="14" y2="14" />
  </svg>
);
const MoneyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);
const MyDayIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);
const ClockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);
const ChatIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
const MoreIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="12" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="19" cy="12" r="1.4" />
  </svg>
);

// Routes that belong to the Customers group (so its tab stays lit on sub-pages).
const CUSTOMER_AREA = ["/customers", "/pipeline", "/tasks"];
// The field/tech surfaces — these get the field tab set, not the office one.
const FIELD_ROUTES = ["/my-day", "/my-hours", "/messages", "/account"];

interface Tab {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  count?: number;
}

export function MobileTabs({ initialMe }: { initialMe?: RouterOutputs["v1"]["identity"]["me"] }) {
  const pathname = usePathname();
  const me = useMe(initialMe);
  // Primitive selectors — return numbers so referential equality suppresses
  // re-renders when unrelated store slices are written.
  const customerCount = useAppStore(selectCustomerCount);
  const jobsCount = useAppStore(selectJobsCount);
  const moneyCount = useAppStore(selectMoneyCount);

  // Don't decide the tab set until the role is known — else a tech doing a cold
  // load on a non-field route would flash the office tabs before role resolves.
  if (me.isLoading) return null;

  // A tech always gets the field tab set, regardless of current route.
  // While role is loading, fall back to route-based detection so there's no
  // permanent flash — once resolved, role wins.
  const isTech = me.data?.role === "tech";
  const onField = isTech || FIELD_ROUTES.some((r) => pathname.startsWith(r));

  const officeTabs: Tab[] = [
    { href: "/dashboard", label: "Home", icon: <HomeIcon />, active: pathname.startsWith("/dashboard") },
    {
      href: "/customers",
      label: "Customers",
      icon: <PeopleIcon />,
      active: CUSTOMER_AREA.some((r) => pathname.startsWith(r)),
      count: customerCount,
    },
    { href: "/jobs", label: "Jobs", icon: <JobsIcon />, active: pathname.startsWith("/jobs"), count: jobsCount },
    { href: "/money", label: "Money", icon: <MoneyIcon />, active: pathname.startsWith("/money"), count: moneyCount },
    // "More" = the overflow: Settings + the Field surfaces + account (see /more).
    { href: "/more", label: "More", icon: <MoreIcon />, active: pathname.startsWith("/more") || pathname.startsWith("/settings") },
  ];

  const fieldTabs: Tab[] = [
    { href: "/my-day", label: "My day", icon: <MyDayIcon />, active: pathname.startsWith("/my-day") },
    { href: "/my-hours", label: "My hours", icon: <ClockIcon />, active: pathname.startsWith("/my-hours") },
    { href: "/messages", label: "Messages", icon: <ChatIcon />, active: pathname.startsWith("/messages") },
    { href: "/account", label: "More", icon: <MoreIcon />, active: pathname.startsWith("/account") },
  ];

  const tabs = onField ? fieldTabs : officeTabs;

  return (
    <nav id="mobiletabs" aria-label="Primary">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className={`mtab${t.active ? " active" : ""}`} aria-current={t.active ? "page" : undefined}>
          <span className="ic" aria-hidden="true">{t.icon}</span>
          {t.label}
          {t.count ? <span className="mb">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
