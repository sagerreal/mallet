"use client";

import { useEffect, useState } from "react";

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

export function Topbar({ section = "Customer", label = "Home" }: TopbarProps) {
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
      <select className="rolesel" defaultValue="owner" title="Preview what each role sees">
        <option value="owner">View as Owner</option>
        <option value="office">View as Office</option>
        <option value="tech">View as Tech</option>
      </select>
      <button className="iconbtn" title="Notifications" style={{ position: "relative" }}>
        <BellIcon />
      </button>
    </header>
  );
}
