"use client";

/**
 * app/(field)/account/page.tsx
 * The "More" overflow page for the field tab bar — accessible to any role
 * (tech, office, owner). Always shows the three field surfaces. Shows an
 * "Office" section for owner/office roles so an owner-operator can navigate
 * back to the back-office from the field shell.
 */

import Link from "next/link";
import { useMe } from "@/features/identity/hooks";
import { SignOutButton } from "@/components/shell/sign-out-button";

const FIELD_LINKS: Array<{ href: string; label: string }> = [
  { href: "/my-day", label: "My day" },
  { href: "/my-hours", label: "My hours" },
  { href: "/messages", label: "Messages" },
];

const OFFICE_LINKS: Array<{ href: string; label: string }> = [
  { href: "/dashboard", label: "Home" },
  { href: "/customers", label: "Customers" },
  { href: "/jobs", label: "Jobs" },
  { href: "/money", label: "Money" },
  { href: "/settings", label: "Settings" },
];

function MenuGroup({ label, links }: { label: string; links: Array<{ href: string; label: string }> }) {
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

export default function FieldAccountPage() {
  const me = useMe();
  const role = me.data?.role;
  const orgName = me.data?.orgName ?? "My Business";
  const displayName = me.data?.email?.split("@")[0] ?? "You";
  const initials =
    displayName.split(/[._\-]+/).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase() || "ME";

  const isOffice = role === "owner" || role === "office";

  return (
    <div className="morepage">
      <h1>More</h1>

      <div className="moreacct">
        <span className="avatar">{initials}</span>
        <div className="who">
          <b>{displayName}</b>
          <span>{orgName}</span>
        </div>
      </div>

      <MenuGroup label="Field" links={FIELD_LINKS} />

      {isOffice && <MenuGroup label="Office" links={OFFICE_LINKS} />}

      <div style={{ marginTop: 18 }}>
        <SignOutButton />
      </div>
    </div>
  );
}
