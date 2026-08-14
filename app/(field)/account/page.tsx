"use client";

/**
 * app/(field)/account/page.tsx
 * The "More" overflow page for the field tab bar — accessible to any role
 * (tech, office, owner). Always shows the three field surfaces. Shows an
 * "Office" section for owner/office roles so an owner-operator can navigate
 * back to the back-office from the field shell.
 *
 * The destinations come from components/shell/more-links, shared with /more. They used to be a
 * second hand-written copy and had drifted: Front Desk and Pricebook were missing outright here,
 * so an owner who reached this page from the field shell could not get to either.
 */

import { useMe } from "@/features/identity/hooks";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { CallbackNumberForm } from "@/features/settings/callback-number-form";
import { MenuGroup, OFFICE_LINKS, FIELD_LINKS } from "@/components/shell/more-links";

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

      {/* The one setting a technician owns. Office roles set the same number in Settings → Your
          account; a tech has no Settings page, and pressing Call without it does nothing. Sits
          below the destinations because this page is navigation first — a setting is not a place
          you go. */}
      <div className="moregroup">
        <div className="morelabel">Calls</div>
        <CallbackNumberForm />
      </div>

      <div style={{ marginTop: "var(--space-5)" }}>
        <SignOutButton />
      </div>
    </div>
  );
}
