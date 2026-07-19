"use client";

/**
 * app/(office)/more/page.tsx
 * The mobile "More" menu — the overflow the 5-tab bar can't hold. On desktop the
 * sidebar carries every destination; on a phone the tab bar shows only the core
 * four, so this page is how office users reach the Field surfaces (My day / My
 * hours / Messages — e.g. an owner-operator who also works jobs), Settings, and
 * their account / sign-out. Reachable via the "More" tab; harmless on desktop.
 */

import Link from "next/link";
import { useMe } from "@/features/identity/hooks";
import { SignOutButton } from "@/components/shell/sign-out-button";

const OFFICE_LINKS: Array<{ href: string; label: string }> = [
  { href: "/dashboard", label: "Office" },
  { href: "/frontdesk", label: "Front Desk" },
  { href: "/customers", label: "Customers" },
  { href: "/jobs", label: "Jobs" },
  { href: "/pricebook", label: "Pricebook" },
  { href: "/money", label: "Money" },
  { href: "/settings", label: "Settings" },
];

const FIELD_LINKS: Array<{ href: string; label: string }> = [
  { href: "/my-day", label: "My day" },
  { href: "/my-hours", label: "My hours" },
  { href: "/messages", label: "Messages" },
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

export default function MorePage() {
  const me = useMe();
  const orgName = me.data?.orgName ?? "My Business";
  const displayName = me.data?.email?.split("@")[0] ?? "You";
  const initials =
    displayName.split(/[._\-]+/).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase() || "ME";

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

      <MenuGroup label="Office" links={OFFICE_LINKS} />
      <MenuGroup label="Field" links={FIELD_LINKS} />

      <div style={{ marginTop: 18 }}>
        <SignOutButton />
      </div>
    </div>
  );
}
