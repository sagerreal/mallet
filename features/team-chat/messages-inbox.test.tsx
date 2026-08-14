// @vitest-environment jsdom
/**
 * features/team-chat/messages-inbox.test.tsx
 *
 * The inbox never mixes the two kinds of conversation — the segmented control picks one, and each
 * list renders only its own. So a "Team" tag on every team row labels a set that is already
 * entirely team, and a tech (who has no customer inbox at all) got it on every row they will ever
 * see. On a phone that tag and the unread badge take the width the NAME needs, and the names
 * truncate: "SWEEP2 group 17…", "AUDIT mgrp 875306 F…".
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { TeamThreadDTO } from "@mallet/team-chat";

const listThreads = vi.fn();
const listConversations = vi.fn();

vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      teamChat: { listThreads: { useQuery: () => listThreads() } },
      messaging: { listConversations: { useQuery: () => listConversations() } },
    },
  },
}));
vi.mock("@/components/modals/thread-modal", () => ({ CustomerThreadPane: () => null }));
let paneProps: { subtitle?: string } = {};
vi.mock("@/components/modals/team-chat-modal", () => ({
  TeamChatPane: (p: { subtitle?: string }) => {
    paneProps = p;
    return null;
  },
}));
vi.mock("./new-conversation", () => ({ NewConversation: () => null }));

import { MessagesInbox } from "./messages-inbox";

const thread = (over: Partial<TeamThreadDTO> = {}): TeamThreadDTO =>
  ({
    id: "t1",
    kind: "group",
    title: "Drain crew — Tuesday",
    members: [{ userId: "u1", name: "Ada" }, { userId: "u2", name: "Bo" }],
    lastMessageAt: new Date().toISOString(),
    lastBody: "on my way to the Novak job",
    lastAuthorUserId: "u2",
    lastHadAttachment: false,
    unreadCount: 0,
    ...over,
  }) as TeamThreadDTO;

const settled = (rows: unknown[]) => ({
  data: rows,
  isFetched: true,
  isError: false,
  isRefetching: false,
  refetch: vi.fn(),
});

describe("MessagesInbox — the team list", () => {
  it("does not label every row 'Team' in a list that is entirely team", () => {
    listThreads.mockReturnValue(settled([thread()]));
    listConversations.mockReturnValue(settled([]));

    render(<MessagesInbox canSeeCustomers={false} meUserId="u1" />);

    expect(screen.getByText("Drain crew — Tuesday")).toBeTruthy();
    expect(screen.queryByText("Team")).toBeNull();
  });

  it("still shows the unread count, which is the one thing that varies per row", () => {
    listThreads.mockReturnValue(settled([thread({ unreadCount: 3 })]));
    listConversations.mockReturnValue(settled([]));

    render(<MessagesInbox canSeeCustomers={false} meUserId="u1" />);

    expect(screen.getByText("3")).toBeTruthy();
  });
});

describe("MessagesInbox — the thread header says a thing once", () => {
  // An INTERNAL pill sits directly beside this subtitle. "Internal — never seen by a customer"
  // next to a pill reading INTERNAL is the same fact twice, and on a phone the header ran 94px
  // before a single message.
  const open = (t: TeamThreadDTO) => {
    paneProps = {};
    listThreads.mockReturnValue(settled([t]));
    listConversations.mockReturnValue(settled([]));
    const { container } = render(<MessagesInbox canSeeCustomers={false} meUserId="u1" />);
    fireEvent.click(container.querySelector(".msg-row") as HTMLElement);
  };

  it("keeps the member count on a group — that is real information", () => {
    open(thread({ kind: "group" }));
    expect(paneProps.subtitle).toBe("2 people");
  });

  it("says nothing at all on a DM, where the pill has already said it", () => {
    open(thread({ kind: "dm", title: null } as Partial<TeamThreadDTO>));
    expect(paneProps.subtitle ?? "").toBe("");
  });
});
