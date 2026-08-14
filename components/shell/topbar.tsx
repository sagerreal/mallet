"use client";


import { usePathname, useRouter } from "next/navigation";
import { isTabRoot, parentRouteOf } from "@/components/shell/tab-roots";

/**
 * Route → breadcrumb, so the topbar reflects the current screen (like the prototype's crumb).
 *
 * The section is the SIDEBAR's own group (components/shell/sidebar.tsx): Office holds the shop's
 * own surfaces, Customers holds the book and its paper, and Jobs, Money and Settings are
 * top-level items that are nobody's child. Every office route used to open with a hardcoded
 * "Customer", so Money read "Customer › Money" and Settings "Customer › Settings" — the crumb
 * named the wrong part of the app on eleven of its thirteen entries.
 *
 * A top-level item takes an empty label: the crumb is then the section alone rather than the
 * word twice.
 */
const CRUMBS: Record<string, { section: string; label: string }> = {
  "/dashboard": { section: "Office", label: "Today" },
  "/frontdesk": { section: "Office", label: "Front Desk" },
  "/pricebook": { section: "Office", label: "Pricebook" },
  "/customers": { section: "Customers", label: "" },
  "/quotes": { section: "Customers", label: "Quotes" },
  "/tasks": { section: "Customers", label: "Tasks" },
  "/composer": { section: "Customers", label: "New quote" },
  "/jobs": { section: "Jobs", label: "" },
  "/money": { section: "Money", label: "" },
  "/settings": { section: "Settings", label: "" },
  "/more": { section: "More", label: "" },
  "/my-day": { section: "Field", label: "My day" },
  "/my-hours": { section: "Field", label: "My hours" },
  "/messages": { section: "Field", label: "Messages" },
  // The field shell's own overflow page. Missing entirely, so it fell through to the default
  // and read "Customer › Home" — a page that is neither.
  "/account": { section: "Field", label: "More" },
};

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
  // An unmapped route names the app rather than inventing a section for it — the old fallback
  // ("Customer › Home") asserted a place the screen was not in.
  const section = sectionProp ?? crumb?.section ?? "Mallet";
  const label = labelProp ?? crumb?.label ?? "";

  // The bottom tab bar is the only navigation on a phone and reaches nine routes.
  // Everything else (/tasks, /composer, /settings, /jobs/:id, /money/:id)
  // was a dead end — and a WKWebView has no browser chrome to fall back on.
  const showBack = !isTabRoot(pathname);
  const goBack = () => {
    // A cold launch straight onto a deep route has nothing to pop, so fall back to
    // the route's own parent rather than doing nothing.
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push(parentRouteOf(pathname));
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
            an unlabeled 20px + in the corner was too small for the app's key action.
            The light/dark toggle lived here too — cut Aug 2026 (Owen): the app commits to
            its one look, and a corner control nobody asked for was chrome in the way. */}
        {/* Mobile-only (CSS-hidden on desktop, where the sidebar reaches Settings): the
            "More" overflow moved up here so the tab bar's create button sits dead-center. */}
        <button className="iconbtn topmore" onClick={() => router.push("/more")} aria-label="More" title="More">
          <MoreIcon />
        </button>
    </header>
  );
}
