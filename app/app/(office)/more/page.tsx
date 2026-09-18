"use client";

/**
 * app/(office)/more/page.tsx
 * The mobile "More" menu — the overflow the 5-tab bar can't hold. On desktop the
 * sidebar carries every destination; on a phone the tab bar shows only the core
 * four, so this page is how office users reach the Field surfaces (My day / My
 * hours / Messages — e.g. an owner-operator who also works jobs), Settings, and
 * their account / sign-out. Reachable via the "More" tab; harmless on desktop.
 *
 * The destinations come from components/shell/more-links, shared with the field shell's own
 * /account page — the two lists were separate copies and had drifted apart.
 */

import { useMe } from "@/features/identity/hooks";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { MenuGroup, OFFICE_LINKS, FIELD_LINKS } from "@/components/shell/more-links";

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

      <div style={{ marginTop: "var(--space-5)" }}>
        <SignOutButton />
      </div>
    </div>
  );
}
