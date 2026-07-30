"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isTabRoot, parentRouteOf } from "@/components/shell/tab-roots";
import { THEME_STORAGE_KEY, nextTheme, type Theme } from "@/lib/theme";

// Route → breadcrumb, so the topbar reflects the current screen (like the prototype's crumb).
const CRUMBS: Record<string, { section: string; label: string }> = {
  "/dashboard": { section: "Customer", label: "Office" },
  "/frontdesk": { section: "Customer", label: "Front Desk" },
  "/customers": { section: "Customer", label: "Customers" },
  "/quotes": { section: "Customer", label: "Quotes" },
  "/pipeline": { section: "Customer", label: "Pipeline" },
  "/tasks": { section: "Customer", label: "Tasks" },
  "/composer": { section: "Customer", label: "New quote" },
  "/jobs": { section: "Customer", label: "Jobs" },
  "/pricebook": { section: "Customer", label: "Pricebook" },
  "/money": { section: "Customer", label: "Money" },
  "/settings": { section: "Customer", label: "Settings" },
  "/more": { section: "Customer", label: "More" },
  "/my-day": { section: "Field", label: "My day" },
  "/my-hours": { section: "Field", label: "My hours" },
  "/messages": { section: "Field", label: "Messages" },
};

const BellIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
);

const SunIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

const MoonIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const ChevronLeftIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const MoreIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="12" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="19" cy="12" r="1.4" />
  </svg>
);

interface TopbarProps {
  section?: string;
  label?: string;
}

export function Topbar({ section: sectionProp, label: labelProp }: TopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  // Longest-prefix match so nested routes inherit the parent crumb.
  const matched = Object.keys(CRUMBS)
    .filter((route) => pathname === route || pathname.startsWith(route + "/"))
    .sort((a, b) => b.length - a.length)[0];
  const crumb = matched ? CRUMBS[matched] : undefined;
  const section = sectionProp ?? crumb?.section ?? "Customer";
  const label = labelProp ?? crumb?.label ?? "Home";
  const [theme, setTheme] = useState<Theme>("light");

  // The bottom tab bar is the only navigation on a phone and reaches nine routes.
  // Everything else (/pipeline, /tasks, /composer, /settings, /jobs/:id, /money/:id)
  // was a dead end — and a WKWebView has no browser chrome to fall back on.
  const showBack = !isTabRoot(pathname);
  const goBack = () => {
    // A cold launch straight onto a deep route has nothing to pop, so fall back to
    // the route's own parent rather than doing nothing.
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push(parentRouteOf(pathname));
  };

  useEffect(() => {
    // Adopt whatever is ALREADY on screen. The pre-paint script in app/layout.tsx has
    // already resolved stored-choice-or-system onto data-theme, so the attribute is the
    // source of truth — not localStorage, which is empty for a system-dark user who has
    // never toggled. Reading localStorage here is what made the first tap a no-op on a
    // system-dark phone: state said "light" while the screen was dark.
    const applied = document.documentElement.getAttribute("data-theme");
    if (applied === "dark" || applied === "light") setTheme(applied);
  }, []);

  const toggleTheme = () => {
    const next = nextTheme(theme);
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    // Writing it is what promotes this from "following the system" to an explicit
    // choice that outlives sunset.
    localStorage.setItem(THEME_STORAGE_KEY, next);
  };

  return (
    <header className="topbar">
        {showBack && (
          <button className="iconbtn topback" onClick={goBack} aria-label="Back" title="Back">
            <ChevronLeftIcon />
          </button>
        )}
        <div className="crumb" id="crumb">
          <b>{section}</b>
          {label && (
            <>
              <span className="sep">›</span>
              {label}
            </>
          )}
        </div>
        <div className="spacer" />
        {/* Create moved to the tab bar's center button (mobile) / the sidebar (desktop) —
            an unlabeled 20px + in the corner was too small for the app's key action. */}
        <button className="iconbtn" onClick={toggleTheme} title="Light / dark">
          {theme === "light" ? <MoonIcon /> : <SunIcon />}
        </button>
        <button className="iconbtn" title="Notifications" style={{ position: "relative" }}>
          <BellIcon />
        </button>
        {/* Mobile-only (CSS-hidden on desktop, where the sidebar reaches Settings): the
            "More" overflow moved up here so the tab bar's create button sits dead-center. */}
        <button className="iconbtn topmore" onClick={() => router.push("/more")} aria-label="More" title="More">
          <MoreIcon />
        </button>
    </header>
  );
}
