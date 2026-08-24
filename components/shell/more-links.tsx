"use client";

/**
 * components/shell/more-links.tsx
 * The "More" overflow menu, shared by the two pages that are both titled More: /more (the office
 * tab bar's overflow) and /account (the field tab bar's).
 *
 * They each carried a hand-written copy of this list and drifted: /account was missing Front Desk
 * and Pricebook outright, so an owner-operator who reached it from the field shell could not get
 * to either, and it labelled /dashboard "Home" where every other surface calls it "Office". One
 * module means a destination added here cannot go missing from one of them.
 *
 * Only the OFFICE group is role-gated at the call site — the field surfaces belong to everyone.
 */

import Link from "next/link";

export interface MoreLink {
  readonly href: string;
  readonly label: string;
}

/** The back-office destinations, in the sidebar's own order. */
export const OFFICE_LINKS: readonly MoreLink[] = [
  { href: "/dashboard", label: "Office" },
  { href: "/dashboard?tab=frontdesk", label: "Front Desk" },
  { href: "/customers", label: "Customers" },
  { href: "/jobs", label: "Jobs" },
  { href: "/dashboard?tab=pricebook", label: "Pricebook" },
  { href: "/money", label: "Money" },
  // The AI employee's board — a top-level page like Settings, not a bottom tab, so a phone
  // reaches it here rather than through #mobiletabs.
  { href: "/artie", label: "Artie" },
  { href: "/settings", label: "Settings" },
];

/** The three field surfaces — a tech's whole app, and an owner-operator's other half. */
export const FIELD_LINKS: readonly MoreLink[] = [
  { href: "/my-day", label: "My day" },
  { href: "/my-hours", label: "My hours" },
  { href: "/messages", label: "Messages" },
];

export interface MenuGroupProps {
  readonly label: string;
  readonly links: readonly MoreLink[];
}

export function MenuGroup({ label, links }: MenuGroupProps) {
  return (
    <div className="moregroup">
      <div className="morelabel">{label}</div>
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="morerow">
          <span>{l.label}</span>
          <span className="morechev" aria-hidden="true">›</span>
        </Link>
      ))}
    </div>
  );
}
