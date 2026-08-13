"use client";

/**
 * Messages — one inbox holding both kinds of conversation.
 *
 * Customers go out over the business number and a customer reads them; team conversations stay
 * inside the shop. MessagesInbox owns that split and the two-pane layout; this page is the route
 * and the role read, nothing more.
 *
 * The pinned "Artie" card and its canned iPhone demo used to sit at the top of this page. Both
 * are gone: the demo was the last hard-coded sample conversation in a codebase that bans sample
 * data, and the card pushed the real inbox down the screen for a link nobody came here to use.
 */

import { useMe } from "@/features/identity/hooks";
import { MessagesInbox } from "@/features/team-chat/messages-inbox";

export default function MessagesPage() {
  const { data: me, isLoading: meLoading } = useMe();

  // Customer texts are owner/office only (v1.messaging is ownerOrOffice). While the role query is
  // in flight we do not yet know, so hold the customer side back rather than flash a FORBIDDEN.
  const canSeeCustomers = !meLoading && (me?.role === "owner" || me?.role === "office");

  return (
    <>
      <h1>Messages</h1>
      <MessagesInbox canSeeCustomers={canSeeCustomers} meUserId={me?.userId} />
    </>
  );
}
