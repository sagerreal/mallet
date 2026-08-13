// @vitest-environment jsdom
/**
 * features/team-chat/team-inbox.test.tsx
 * The staff inbox: what a row SAYS (a DM is named after the other person, a group after itself),
 * the four list states, and the in-flow new-conversation panel that decides DM-vs-group from the
 * selection rather than making you pick a type first.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TeamInbox } from "./team-inbox";

const ME = "11111111-1111-4111-8111-111111111111";
const MIKE = "22222222-2222-4222-8222-222222222222";
const PRIYA = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => ({
  threads: { data: [] as unknown[], isFetched: true, isError: false, isRefetching: false, refetch: vi.fn() },
  roster: {
    data: [] as unknown[],
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: vi.fn(),
  },
  openModal: vi.fn(),
  startDm: vi.fn(() => Promise.resolve({ threadId: "t-dm" })),
  createGroup: vi.fn(() => Promise.resolve({ threadId: "t-group" })),
}));

vi.mock("@/lib/store/app-store", () => ({
  useOpenModal: () => h.openModal,
}));

vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      teamChat: {
        listThreads: { useQuery: () => h.threads },
        roster: { useQuery: () => h.roster },
      },
    },
  },
}));

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      teamChat: {
        startDm: { mutate: h.startDm },
        createGroup: { mutate: h.createGroup },
      },
    },
  },
}));

const dm = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  kind: "dm" as const,
  title: null,
  lastMessageAt: "2026-08-13T17:00:00.000Z",
  lastBody: "bringing the 40 gal",
  lastAuthorUserId: MIKE,
  lastHadAttachment: false,
  unreadCount: 0,
  members: [
    { userId: ME, name: "Dana Alvarez" },
    { userId: MIKE, name: "Mike Rivera" },
  ],
  ...over,
});

const group = (over: Record<string, unknown> = {}) => ({
  id: "t2",
  kind: "group" as const,
  title: "Friday van checks",
  lastMessageAt: "2026-08-13T16:00:00.000Z",
  lastBody: "inspections before dispatch",
  lastAuthorUserId: ME,
  lastHadAttachment: false,
  unreadCount: 0,
  members: [
    { userId: ME, name: "Dana Alvarez" },
    { userId: MIKE, name: "Mike Rivera" },
    { userId: PRIYA, name: "Priya Anand" },
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.threads = { data: [], isFetched: true, isError: false, isRefetching: false, refetch: vi.fn() };
  h.roster = { data: [], isLoading: false, isError: false, isRefetching: false, refetch: vi.fn() };
});

describe("TeamInbox — what a row says", () => {
  it("names a DM after the OTHER person, never after the reader", () => {
    h.threads.data = [dm()];
    render(<TeamInbox meUserId={ME} />);
    expect(screen.getByText("Mike Rivera")).toBeTruthy();
    expect(screen.queryByText("Dana Alvarez")).toBeNull();
  });

  it("names a group after itself and shows its size", () => {
    h.threads.data = [group()];
    render(<TeamInbox meUserId={ME} />);
    expect(screen.getByText("Friday van checks")).toBeTruthy();
    expect(screen.getByText(/3 people/)).toBeTruthy();
  });

  it("prefixes MY last message with 'You:' and leaves a teammate's plain", () => {
    h.threads.data = [group({ lastAuthorUserId: ME, lastBody: "on it" }), dm({ lastBody: "eta?" })];
    render(<TeamInbox meUserId={ME} />);
    expect(screen.getByText("You: on it")).toBeTruthy();
    expect(screen.getByText("eta?")).toBeTruthy();
  });

  it("says 'Photo' when the last message was an image with no caption", () => {
    h.threads.data = [dm({ lastBody: "", lastHadAttachment: true })];
    render(<TeamInbox meUserId={ME} />);
    expect(screen.getByText("Photo")).toBeTruthy();
  });

  it("shows the unread COUNT, not just a dot — and nothing when read", () => {
    h.threads.data = [dm({ unreadCount: 3 })];
    const { unmount } = render(<TeamInbox meUserId={ME} />);
    expect(screen.getByText("3")).toBeTruthy();
    unmount();

    h.threads.data = [dm({ unreadCount: 0 })];
    render(<TeamInbox meUserId={ME} />);
    expect(screen.queryByText("3")).toBeNull();
  });

  it("opens the thread with the name the row showed (the field shell has no roster to look it up in)", () => {
    h.threads.data = [dm()];
    render(<TeamInbox meUserId={ME} />);
    fireEvent.click(screen.getByText("Mike Rivera"));
    expect(h.openModal).toHaveBeenCalledWith(
      "team-chat",
      expect.objectContaining({ threadId: "t1", title: "Mike Rivera" }),
    );
  });

  it("rows are keyboard-operable, not mouse-only", () => {
    h.threads.data = [dm()];
    render(<TeamInbox meUserId={ME} />);
    const row = screen.getByText("Mike Rivera").closest("[role='button']");
    expect(row).toBeTruthy();
    fireEvent.keyDown(row!, { key: "Enter" });
    expect(h.openModal).toHaveBeenCalled();
  });
});

describe("TeamInbox — the four list states", () => {
  it("first load in flight → loading, never a false empty", () => {
    h.threads = { data: undefined as never, isFetched: false, isError: false, isRefetching: false, refetch: vi.fn() };
    render(<TeamInbox meUserId={ME} />);
    expect(screen.getByText("Loading conversations…")).toBeTruthy();
  });

  it("errored with nothing cached → a retry, NOT 'no conversations'", () => {
    h.threads = { data: undefined as never, isFetched: true, isError: true, isRefetching: false, refetch: vi.fn() };
    render(<TeamInbox meUserId={ME} />);
    expect(screen.getByRole("button", { name: /Try again/ })).toBeTruthy();
    expect(screen.queryByText(/No team conversations yet/)).toBeNull();
  });

  it("loaded and genuinely empty → one line pointing at the control already on screen", () => {
    render(<TeamInbox meUserId={ME} />);
    expect(screen.getByText(/No team conversations yet/)).toBeTruthy();
  });

  it("populated → rows, and no empty copy", () => {
    h.threads.data = [dm()];
    render(<TeamInbox meUserId={ME} />);
    expect(screen.queryByText(/No team conversations yet/)).toBeNull();
  });
});

describe("TeamInbox — starting a conversation", () => {
  it("the picker expands IN FLOW under its own button (no floating panel)", () => {
    render(<TeamInbox meUserId={ME} />);
    const toggle = screen.getByRole("button", { name: "+ New message" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Cancel" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("one person picked → a DM, no name asked for", async () => {
    h.roster.data = [{ userId: MIKE, name: "Mike Rivera", role: "tech" }];
    render(<TeamInbox meUserId={ME} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New message" }));
    fireEvent.click(screen.getByRole("button", { name: "Mike Rivera" }));

    expect(screen.queryByText("Group name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start message" }));
    await vi.waitFor(() => expect(h.startDm).toHaveBeenCalledWith({ userId: MIKE }));
    expect(h.createGroup).not.toHaveBeenCalled();
  });

  it("two people picked → it becomes a group and asks for a name before it will start", async () => {
    h.roster.data = [
      { userId: MIKE, name: "Mike Rivera", role: "tech" },
      { userId: PRIYA, name: "Priya Anand", role: "office" },
    ];
    render(<TeamInbox meUserId={ME} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New message" }));
    fireEvent.click(screen.getByRole("button", { name: "Mike Rivera" }));
    fireEvent.click(screen.getByRole("button", { name: "Priya Anand" }));

    // A nameless group is refused by the DB CHECK, so the control is disabled until it has one.
    const start = screen.getByRole("button", { name: /Start group/ }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Group name"), { target: { value: "Repipe crew" } });
    fireEvent.click(screen.getByRole("button", { name: /Start group/ }));
    await vi.waitFor(() =>
      expect(h.createGroup).toHaveBeenCalledWith({ title: "Repipe crew", userIds: [MIKE, PRIYA] }),
    );
  });

  it("a one-person shop is told to invite the crew, not shown a dead picker", () => {
    render(<TeamInbox meUserId={ME} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New message" }));
    expect(screen.getByText(/only person in this shop/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start message" })).toBeNull();
  });

  it("a failed roster load offers a retry rather than an empty team", () => {
    h.roster = { data: undefined as never, isLoading: false, isError: true, isRefetching: false, refetch: vi.fn() };
    render(<TeamInbox meUserId={ME} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New message" }));
    const panel = screen.getByRole("alert");
    expect(within(panel).getByRole("button", { name: /Try again/ })).toBeTruthy();
  });
});
