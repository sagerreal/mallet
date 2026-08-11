"use client";


import { usePathname, useRouter } from "next/navigation";
import { isTabRoot, parentRouteOf } from "@/components/shell/tab-roots";

// Route → breadcrumb, so the topbar reflects the current screen (like the prototype's crumb).
const CRUMBS: Record<string, { section: string; label: string }> = {
  "/dashboard": { section: "Customer", label: "Office" },
  "/frontdesk": { section: "Customer", label: "Front Desk" },
  "/customers": { section: "Customer", label: "Customers" },
  "/quotes": { section: "Customer", label: "Quotes" },
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
