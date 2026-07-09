"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useMe } from "@/features/identity/hooks";
import { useAppStore } from "@/lib/store/app-store";
import { NewMenu } from "@/components/shell/new-menu";
import { signOut } from "@/features/auth/hooks";

// SVG icons matching the prototype
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

const SettingsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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

interface NavItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  count?: number | string;
  active?: boolean;
  inert?: boolean;
}

function NavItem({ href, icon, label, count, active, inert }: NavItemProps) {
  const cls = `navitem${active ? " active" : ""}`;
  if (inert) {
    return (
      <div className={cls} style={{ cursor: "default", opacity: 0.55 }}>
        {icon}
        <span>{label}</span>
        {count ? <span className="cnt">{count}</span> : null}
      </div>
    );
  }
  return (
    <Link href={href} className={cls}>
      {icon}
      <span>{label}</span>
      {count ? <span className="cnt">{count}</span> : null}
    </Link>
  );
}

interface NavSubProps {
  href: string;
  label: string;
  count?: number;
  active: boolean;
}

function NavSub({ href, label, count, active }: NavSubProps) {
  return (
    <Link href={href} className={`navsub${active ? " active" : ""}`}>
      <span>{label}</span>
      {count ? <span className="cnt">{count}</span> : null}
    </Link>
  );
}

// Routes that belong to the Customers group (its sidebar sub-nav).
const CUSTOMER_AREA = ["/customers", "/pipeline", "/tasks"];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();
  const [acctOpen, setAcctOpen] = useState(false);
  const acctRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!acctOpen) return;
    function handleClick(e: MouseEvent) {
      if (acctRef.current && !acctRef.current.contains(e.target as Node)) {
        setAcctOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [acctOpen]);

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }
  const tasks = useAppStore((s) => s.tasks);
  const storeJobs = useAppStore((s) => s.jobs);
  const leads = useAppStore((s) => s.leads);
  const invoices = useAppStore((s) => s.invoices);
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");

  const isActive = (href: string) => pathname.startsWith(href);
  const customersActive = CUSTOMER_AREA.some((r) => pathname.startsWith(r));
  const jobsActive = pathname.startsWith("/jobs");
  const moneyActive = pathname.startsWith("/money");
  const openTaskCount = tasks.filter((t) => !t.done).length;
  const unscheduledCount = storeJobs.filter((j) => !j.archived && j.status === "unscheduled").length;

  // Live counts from the store — the same source every page renders from, so the
  // badges move with the lists (adding a customer bumps Customers, etc.).
  const customerCount = leads.filter((l) => !l.archived).length;
  const jobsCount = storeJobs.filter((j) => !j.archived && j.status !== "done").length;
  const moneyCount = invoices.filter(
    (i) => !i.archived && (i.status === "sent" || i.status === "partial")
  ).length;

  // Account display
  const userObj = me.data;
  const orgName = userObj?.orgName ?? "My Business";
  const displayName = userObj?.email?.split("@")[0] ?? "You";
  const initials = displayName.split(/[._\-]+/).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase() || "ME";

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidehead">
        <div className="brand">
          <span className="bmark">✦</span>
          Mallet
          <span className="brandai">.ai</span>
        </div>
      </div>

      {/* Nav */}
      <div id="sidenav" style={{ flex: 1, overflowY: "auto", padding: "2px 10px 10px" }}>
        {/* + New button */}
        <NewMenu />

        {/* Main nav */}
        <NavItem href="/dashboard" icon={<HomeIcon />} label="Home" active={isActive("/dashboard")} />

        <div className="navsep" />

        <NavItem
          href="/customers"
          icon={<PeopleIcon />}
          label="Customers"
          count={customerCount > 0 ? customerCount : undefined}
          active={customersActive}
        />
        {customersActive && (
          <div className="navsubs">
            <NavSub href="/pipeline" label="Pipeline" active={pathname.startsWith("/pipeline")} />
            <NavSub
              href="/tasks"
              label="Tasks"
              count={openTaskCount > 0 ? openTaskCount : undefined}
              active={pathname.startsWith("/tasks")}
            />
          </div>
        )}
        <NavItem
          href="/jobs"
          icon={<JobsIcon />}
          label="Jobs"
          count={jobsCount > 0 ? jobsCount : undefined}
          active={jobsActive}
        />
        {jobsActive && (
          <div className="navsubs">
            <NavSub
              href="/jobs?tab=schedule"
              label="Schedule"
              count={unscheduledCount > 0 ? unscheduledCount : undefined}
              active={tab === "schedule"}
            />
            <NavSub href="/jobs?tab=timesheets" label="Timesheets" active={tab === "timesheets"} />
          </div>
        )}
        <NavItem
          href="/money"
          icon={<MoneyIcon />}
          label="Money"
          count={moneyCount > 0 ? moneyCount : undefined}
          active={moneyActive}
        />

        <div className="navsep" />

        <NavItem href="/settings" icon={<SettingsIcon />} label="Settings" active={isActive("/settings")} />

        {/* FIELD section — the tech/crew surfaces */}
        <div className="navsep" />
        <div className="navlabel">Field</div>
        <NavItem href="/my-day" icon={<MyDayIcon />} label="My day" active={isActive("/my-day")} />
        <NavItem href="/my-hours" icon={<ClockIcon />} label="My hours" active={isActive("/my-hours")} />
        <NavItem href="/messages" icon={<ChatIcon />} label="Messages" active={isActive("/messages")} />
      </div>

      {/* Account row */}
      <div className="sideacct-wrap" ref={acctRef}>
        {acctOpen && (
          <div className="acct-menu">
            <a
              className="acct-menu-item"
              href="mailto:support@trymallet.com"
              target="_blank"
              rel="noreferrer"
              onClick={() => setAcctOpen(false)}
            >
              Message support
            </a>
            <div className="acct-menu-sep" />
            <button className="acct-menu-item acct-menu-signout" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        )}
        <div
          className={`sideacct${acctOpen ? " open" : ""}`}
          role="button"
          tabIndex={0}
          aria-expanded={acctOpen}
          aria-haspopup="menu"
          onClick={() => setAcctOpen((v) => !v)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setAcctOpen((v) => !v); }}
        >
          <span className="avatar">{initials}</span>
          <div className="who">
            <b>{displayName}</b>
            <span>{orgName}</span>
          </div>
          <span className={`acct-caret${acctOpen ? " up" : ""}`}>⌄</span>
        </div>
      </div>
    </aside>
  );
}
