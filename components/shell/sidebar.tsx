"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useMe } from "@/features/identity/hooks";
import type { RouterOutputs } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { NewMenu } from "@/components/shell/new-menu";
import { NavPending } from "@/components/shell/nav-pending";
import { useNavCounts } from "@/components/shell/use-nav-counts";
import { signOut } from "@/features/auth/hooks";

/** localStorage key for the sidebar rail preference — an explicit toggle outlives the session. */
const RAIL_PREF_KEY = "mallet.nav.rail";
import {
  selectOpenTaskCount,
  selectSentQuoteCount,
  selectCustomerCount,
  selectJobsCount,
  selectUnscheduledCount,
  selectMoneyCount,
} from "@/components/shell/shell-selectors";

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
    <Link href={href} className={cls} title={label}>
      {icon}
      <span>{label}</span>
      {count ? <span className="cnt">{count}</span> : null}
      {/* Inside the Link on purpose — see nav-pending.tsx. */}
      <NavPending />
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
const CUSTOMER_AREA = ["/customers", "/tasks", "/quotes"];

// Routes that belong to the Office group — the shop's own surfaces: today's brief
// (Home content), the AI Front Desk, and the Pricebook.
const OFFICE_AREA = ["/dashboard", "/frontdesk", "/pricebook"];

export function Sidebar({ initialMe }: { initialMe?: RouterOutputs["v1"]["identity"]["me"] }) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe(initialMe);
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
  // Primitive selectors — each returns a number, so referential equality stops
  // re-renders when unrelated slices (e.g. messages, timesheets) are written.
  const openTaskCount = useAppStore(selectOpenTaskCount);
  const sentQuoteCount = useAppStore(selectSentQuoteCount);
  const unscheduledCount = useAppStore(selectUnscheduledCount);
  // Counted by the database, not by what the browser has loaded — see useNavCounts.
  const navCounts = useNavCounts();
  const customerCount = navCounts.customers;
  const jobsCount = navCounts.jobs;
  const moneyCount = navCounts.money ?? 0;
  // The one nav item that carried no badge. A tech's whole app is the three field rows below, so
  // without this there was no unread signal anywhere on their device.
  const messageCount = navCounts.messages ?? 0;
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");

  const isActive = (href: string) => pathname.startsWith(href);
  const customersActive = CUSTOMER_AREA.some((r) => pathname.startsWith(r));
  const officeActive = OFFICE_AREA.some((r) => pathname.startsWith(r));
  const jobsActive = pathname.startsWith("/jobs");
  const moneyActive = pathname.startsWith("/money");

  // Account display
  const userObj = me.data;
  const orgName = userObj?.orgName ?? "My Business";
  const displayName = userObj?.email?.split("@")[0] ?? "You";
  const initials = displayName.split(/[._\-]+/).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase() || "ME";

  // Derive role — undefined while the query is in-flight.
  const role = me.data?.role as "owner" | "office" | "tech" | undefined;
  const isTech = role === "tech";
  // While role is still unknown (loading), show nothing in the nav body to
  // prevent a flash of office items that a tech should never see.
  const roleKnown = !me.isLoading;

  // RAIL: collapsed to a 64px icon strip. Narrow viewports (an iPad, a half-screen window)
  // start collapsed — 248px of nav was exactly the width the Money table's PAID/DUE columns
  // were missing — and an explicit toggle is remembered. Seeded in an effect, not an
  // initializer: the server renders expanded, and reading matchMedia during render would make
  // hydration disagree with SSR.
  const [rail, setRail] = useState(false);
  const focusNewOnExpand = useRef(false);
  useEffect(() => {
    // Guarded like lib/theme.ts: localStorage THROWS outright in some privacy modes, and a
    // throw inside this effect would unmount the shell on every authenticated route.
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(RAIL_PREF_KEY);
    } catch {
      /* privacy mode — fall through to the viewport default */
    }
    if (saved !== null) setRail(saved === "1");
    else if (typeof window.matchMedia === "function") {
      setRail(window.matchMedia("(max-width: 1024px)").matches);
    }
  }, []);
  const setRailAndRemember = (next: boolean) => {
    setRail(next);
    try {
      window.localStorage.setItem(RAIL_PREF_KEY, next ? "1" : "0");
    } catch {
      /* privacy mode — the choice still applies for this session */
    }
  };
  // The rail's "+" swaps itself for the real New menu on expand — without this, the keyboard
  // user who pressed Enter on it is dropped to <body> mid-interaction and has to Tab back from
  // the top of the page.
  useEffect(() => {
    if (!rail && focusNewOnExpand.current) {
      focusNewOnExpand.current = false;
      (document.querySelector(".navnew") as HTMLButtonElement | null)?.focus();
    }
  }, [rail]);

  return (
    <aside className={`sidebar${rail ? " rail" : ""}`}>
      {/* Brand */}
      <div className="sidehead">
        <div className="brand">
          <span className="bmark">✦</span>
          <span className="bword">Mallet</span>
          <span className="brandai">.ai</span>
        </div>
        <button
          type="button"
          className="railtoggle"
          aria-label={rail ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!rail}
          onClick={() => setRailAndRemember(!rail)}
        >
          {rail ? "»" : "«"}
        </button>
      </div>

      {/* Nav */}
      <div id="sidenav" style={{ flex: 1, overflowY: "auto", padding: "var(--space-2xs) var(--space-3) var(--space-3)" }}>
        {/* Office-only items: gated on roleKnown so a tech never briefly sees them.
            The field items below are rendered immediately (no role-conditional risk). */}
        {roleKnown && !isTech && (
          <>
            {rail ? (
              <button
                type="button"
                className="navnew"
                aria-label="Expand navigation to create"
                onClick={() => {
                  focusNewOnExpand.current = true;
                  setRailAndRemember(false);
                }}
              >
                <span className="plus">+</span>
              </button>
            ) : (
              <NewMenu />
            )}

            <NavItem href="/dashboard" icon={<HomeIcon />} label="Office" active={officeActive} />

            <div className="navsep" />

            <NavItem
              href="/customers"
              icon={<PeopleIcon />}
              label="Customers"
              count={customerCount ? customerCount : undefined}
              active={customersActive}
            />
            {customersActive && (
              <div className="navsubs">
                {/* The paper under the people — the ledger the board's Quoting column is not.
                    Badge = SENT quotes awaiting an answer, the count worth glancing at. */}
                <NavSub
                  href="/quotes"
                  label="Quotes"
                  count={sentQuoteCount > 0 ? sentQuoteCount : undefined}
                  active={pathname.startsWith("/quotes")}
                />
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
              count={jobsCount ? jobsCount : undefined}
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
            {/* ARTIE'S BOARD IS HIDDEN FROM THE NAV, not deleted. /artie still renders and a saved
                link still opens it — this removes the standing invitation to go there, because the
                counter bar at the bottom of every page IS Artie, and a second front door implied
                two different assistants. Put the NavItem back (and the /artie entry in
                more-links.tsx) to show it again; nothing else has to change. */}

            <div className="navsep" />

            <NavItem href="/settings" icon={<SettingsIcon />} label="Settings" active={isActive("/settings")} />

            <div className="navsep" />

            {/* FIELD label: only shown for office/owner (tech has no preceding office block) */}
            <div className="navlabel">Field</div>
          </>
        )}

        {/* Field items are always rendered once role is known (or we're on a field route).
            Tech users go straight here; office/owner get them after the office block. */}
        <NavItem href="/my-day" icon={<MyDayIcon />} label="My day" active={isActive("/my-day")} />
        <NavItem href="/my-hours" icon={<ClockIcon />} label="My hours" active={isActive("/my-hours")} />
        <NavItem
          href="/messages"
          icon={<ChatIcon />}
          label="Messages"
          count={messageCount > 0 ? messageCount : undefined}
          active={isActive("/messages")}
        />
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
          // In the rail this control EXPANDS the navigation (a 64px column cannot host the
          // menu) — claiming "menu, collapsed" and then not opening one is a lie to a screen
          // reader, so the menu semantics apply only when the menu is what a press does.
          aria-label={rail ? "Expand navigation to open your account" : undefined}
          aria-expanded={rail ? undefined : acctOpen}
          aria-haspopup={rail ? undefined : "menu"}
          onClick={() => (rail ? setRailAndRemember(false) : setAcctOpen((v) => !v))}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              if (rail) setRailAndRemember(false);
              else setAcctOpen((v) => !v);
            }
          }}
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
