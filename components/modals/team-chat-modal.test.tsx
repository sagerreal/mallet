// @vitest-environment jsdom
/**
 * components/modals/team-chat-modal.test.tsx
 * The staff thread sheet: which side a bubble sits on, that a photo and its caption are ONE
 * message, that a failed send gives the words back, and that opening clears only MY badge.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TeamChatModalContent } from "./team-chat-modal";

const h = vi.hoisted(() => ({
  params: { threadId: "t1", title: "Mike Rivera" } as Record<string, unknown>,
  messages: [] as unknown[],
  isLoading: false,
  send: vi.fn(() => Promise.resolve({})),
  markRead: vi.fn(() => Promise.resolve({ cleared: true })),
  leave: vi.fn(() => Promise.resolve({ left: true })),
  invalidateMessages: vi.fn(() => Promise.resolve()),
  invalidateThreads: vi.fn(() => Promise.resolve()),
  upload: vi.fn((_threadId: string, _file: File) => Promise.resolve({ path: "org/t1/p.jpg", mediaType: "image/jpeg", bytes: 2048 })),
  close: vi.fn(),
}));

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ id: "team-chat", params: h.params }),
  useCloseModal: () => h.close,
}));

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      v1: {
        teamChat: {
          listMessages: { invalidate: h.invalidateMessages },
          listThreads: { invalidate: h.invalidateThreads },
        },
      },
    }),
    v1: {
      teamChat: {
        listMessages: { useQuery: () => ({ data: h.messages, isLoading: h.isLoading }) },
        // ChatImage's query — a stable signed URL so an image renders in the test DOM.
        attachmentViewUrl: {
          useQuery: () => ({ data: { url: "https://signed/x", expiresInSeconds: 300 }, isLoading: false, isError: false }),
        },
      },
    },
  },
}));

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      teamChat: {
        send: { mutate: h.send },
        markRead: { mutate: h.markRead },
        leave: { mutate: h.leave },
      },
    },
  },
}));

vi.mock("@/lib/store/upload-chat-photo", () => ({
  uploadChatPhoto: (threadId: string, file: File) => h.upload(threadId, file),
}));

const msg = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  threadId: "t1",
  authorUserId: "u-mike",
  senderName: "Mike Rivera",
  isMine: false,
  body: "bringing the 40 gal",
  attachment: null,
  createdAt: "2026-08-13T17:00:00.000Z",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.params = { threadId: "t1", title: "Mike Rivera" };
  h.messages = [];
  h.isLoading = false;
});

describe("TeamChatModalContent — the thread", () => {
  it("names the conversation and stamps it INTERNAL, so it cannot be mistaken for a customer text", () => {
    render(<TeamChatModalContent />);
    expect(screen.getByText("Mike Rivera")).toBeTruthy();
    expect(screen.getByText("Internal")).toBeTruthy();
    expect(screen.getByText(/Never seen by a customer/)).toBeTruthy();
  });

  it("puts my messages on the right and a teammate's on the left, attributed", () => {
    h.messages = [msg(), msg({ id: "m2", isMine: true, senderName: "Dana Alvarez", body: "on my way" })];
    const { container } = render(<TeamChatModalContent />);
    const sides = Array.from(container.querySelectorAll(".msg")).map((n) =>
      n.className.includes("us") ? "us" : "them",
    );
    expect(sides).toEqual(["them", "us"]);
    // A teammate's bubble is attributed; my own is not ("You ·" would be noise on every row).
    expect(screen.getByText(/Mike Rivera ·/)).toBeTruthy();
    expect(screen.queryByText(/Dana Alvarez ·/)).toBeNull();
  });

  it("renders a photo message, with the caption as its alt text", () => {
    h.messages = [
      msg({ body: "corroded fitting under the sink", attachment: { path: "org/t1/p.jpg", mediaType: "image/jpeg", bytes: 2048 } }),
    ];
    render(<TeamChatModalContent />);
    expect(screen.getByAltText("corroded fitting under the sink")).toBeTruthy();
  });

  it("a captionless photo still gets alt text naming who sent it", () => {
    h.messages = [msg({ body: "", attachment: { path: "org/t1/p.jpg", mediaType: "image/jpeg", bytes: 2048 } })];
    render(<TeamChatModalContent />);
    expect(screen.getByAltText(/from Mike Rivera/)).toBeTruthy();
  });

  it("empty thread invites a first message rather than showing blank space", () => {
    render(<TeamChatModalContent />);
    expect(screen.getByText("No messages yet")).toBeTruthy();
  });
});

describe("TeamChatModalContent — sending", () => {
  it("sends the typed message and clears the box", async () => {
    render(<TeamChatModalContent />);
    const box = screen.getByLabelText("Message");
    fireEvent.change(box, { target: { value: "eta 20 min" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await vi.waitFor(() => expect(h.send).toHaveBeenCalledWith({ threadId: "t1", body: "eta 20 min" }));
    expect((box as HTMLInputElement).value).toBe("");
  });

  it("refuses to send nothing — an empty box is not a message", () => {
    render(<TeamChatModalContent />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(h.send).not.toHaveBeenCalled();
  });

  it("a failed send gives the words BACK and says why", async () => {
    h.send.mockRejectedValueOnce({ data: { code: "NOT_FOUND" } });
    render(<TeamChatModalContent />);
    const box = screen.getByLabelText("Message");
    fireEvent.change(box, { target: { value: "don't lose this" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await vi.waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/no longer in this conversation/)).toBeTruthy();
    expect((box as HTMLInputElement).value).toBe("don't lose this");
  });

  it("a photo and the text in the box go as ONE message, not two", async () => {
    render(<TeamChatModalContent />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "look at this" } });

    const file = new File(["x"], "pipe.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Attach a photo").parentElement!.querySelector("input[type='file']")!, {
      target: { files: [file] },
    });

    await vi.waitFor(() => expect(h.send).toHaveBeenCalledTimes(1));
    expect(h.send).toHaveBeenCalledWith({
      threadId: "t1",
      body: "look at this",
      attachment: { path: "org/t1/p.jpg", mediaType: "image/jpeg", bytes: 2048 },
    });
  });

  it("a failed upload restores the caption and never posts a bubble", async () => {
    h.upload.mockRejectedValueOnce(new Error("network"));
    render(<TeamChatModalContent />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "keep me" } });
    const file = new File(["x"], "pipe.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Attach a photo").parentElement!.querySelector("input[type='file']")!, {
      target: { files: [file] },
    });

    await vi.waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(h.send).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Message") as HTMLInputElement).value).toBe("keep me");
  });
});

describe("TeamChatModalContent — read state", () => {
  it("opening clears MY cursor and refreshes the inbox count", async () => {
    render(<TeamChatModalContent />);
    await vi.waitFor(() => expect(h.markRead).toHaveBeenCalledWith({ threadId: "t1" }));
    await vi.waitFor(() => expect(h.invalidateThreads).toHaveBeenCalled());
  });

  it("a DM offers no Leave — leaving a 1:1 stranded you, and it reopens the moment either of you writes", () => {
    render(<TeamChatModalContent />);
    expect(screen.queryByRole("button", { name: /Leave/ })).toBeNull();
  });

  it("a GROUP can be left, and leaving closes the sheet", async () => {
    h.params = { threadId: "t1", title: "Friday van checks", kind: "group" };
    render(<TeamChatModalContent />);
    fireEvent.click(screen.getByRole("button", { name: "Leave group" }));
    await vi.waitFor(() => expect(h.leave).toHaveBeenCalledWith({ threadId: "t1" }));
    await vi.waitFor(() => expect(h.close).toHaveBeenCalled());
  });
});
