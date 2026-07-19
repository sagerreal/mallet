"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// Route → breadcrumb, so the topbar reflects the current screen (like the prototype's crumb).
const CRUMBS: Record<string, { section: string; label: string }> = {
  "/dashboard": { section: "Customer", label: "Home" },
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

interface TopbarProps {
  section?: string;
  label?: string;
}

export function Topbar({ section: sectionProp, label: labelProp }: TopbarProps) {
  const pathname = usePathname();
  // Longest-prefix match so nested routes inherit the parent crumb.
  const matched = Object.keys(CRUMBS)
    .filter((route) => pathname === route || pathname.startsWith(route + "/"))
    .sort((a, b) => b.length - a.length)[0];
  const crumb = matched ? CRUMBS[matched] : undefined;
  const section = sectionProp ?? crumb?.section ?? "Customer";
  const label = labelProp ?? crumb?.label ?? "Home";
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    // Read stored theme preference
    const stored = localStorage.getItem("mallet-theme") as "light" | "dark" | null;
    if (stored) {
      setTheme(stored);
      document.documentElement.setAttribute("data-theme", stored);
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("mallet-theme", next);
  };

  return (
    <header className="topbar">
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
      <button className="iconbtn" onClick={toggleTheme} title="Light / dark">
        {theme === "light" ? <MoonIcon /> : <SunIcon />}
      </button>
      <button className="iconbtn" title="Notifications" style={{ position: "relative" }}>
        <BellIcon />
      </button>
    </header>
  );
}
