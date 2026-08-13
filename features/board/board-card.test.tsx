// @vitest-environment jsdom
/**
 * features/board/board-card.test.tsx
 * ONE CARD ON THE WORK BOARD: the facts it states, the record it opens, and the one gesture it
 * offers — a prepared text, one click from sent.
 *
 * The three things asserted hardest are the ones that cost money when they're wrong: a Send that
 * fires twice, a Send that looks live when the shop cannot legally text, and a draft that
 * disappears when the action does (the words are still the answer — the button is what's blocked).
 */

import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetWriteErrorListeners, subscribeWriteErrors, type WriteError } from "@/lib/store/write-error";
import { BoardCard } from "./board-card";
import type { BoardItem } from "./types";
import type { OkItem } from "@/features/home/derive";
import type { Estimate, Lead } from "@/lib/store/types";

const spies = vi.hoisted(() => ({
  dispatch: vi.fn(() => Promise.resolve()),
  commit: vi.fn(),
  undo: vi.fn(),
  dismiss: vi.fn(),
  undismiss: vi.fn(),
}));

vi.mock("@/features/home/send", () => ({
  clockNow: () => "8:47pm",
  commitOkSend: (...args: unknown[]) => {
    spies.commit(...args);
    return spies.undo;
  },
  dispatchOkSend: spies.dispatch,
  okSendKey: (item: { key: string }) => `${item.key}-fu1`,
}));

vi.mock("@/lib/store/app-store", () => {
  const state = { dismissAttention: spies.dismiss, undismissAttention: spies.undismiss };
  const useAppStore = Object.assign((sel: (s: typeof state) => unknown) => sel(state), {
    getState: () => state,
  });
  return { useAppStore, useOpenModal: () => vi.fn() };
});

// ---- fixtures ---------------------------------------------------------------

const lead: Lead = {
  id: "11111111-1111-4111-8111-111111111111", name: "Maria Ortiz", phone: "555-0100",
  source: "web", stage: "Quote Sent", age: 3, job: "Water heater leaking", last: "",
};

const estimate: Estimate = {
  id: "e1", num: "EST-1001", leadId: lead.id, title: "Water heater replacement",
  status: "sent", age: 4, viewed: true, fu: { on: true, stage: 0 }, lines: [],
};

const ok: OkItem = {
  key: "okq-e1", kind: "quote-viewed", lead, estimate,
  value: 2890, situation: "read her quote at 9:12pm", editLabel: "Change",
};

const item = (over: Partial<BoardItem> = {}): BoardItem => ({
  key: "be-e1", kind: "estimate", column: "quoting", refId: "e1", leadId: lead.id,
  name: "Maria Ortiz", service: "Water heater replacement", valueDollars: 2890,
  stateLabel: "Reminder due", tone: "attention", needsAction: true, ageLabel: "Quiet 3 days",
  ...over,
});

const reminderItem = item({ ok });
const jobItemFixture = item({
  key: "bj-j1", kind: "job", column: "jobs", refId: "j1", name: "Dana Fox",
  service: "Repipe", stateLabel: "Scheduled", tone: "waiting", needsAction: false,
  ageLabel: "Thu 8:00 AM", ok: undefined,
});

beforeEach(() => {
  spies.dispatch.mockClear();
  spies.commit.mockClear();
  spies.undo.mockClear();
  spies.dismiss.mockClear();
  spies.undismiss.mockClear();
});

afterEach(() => {
  resetWriteErrorListeners();
});

// ---- the tests --------------------------------------------------------------

describe("BoardCard — the prepared text", () => {
  it("shows the prepared text on the card and sends once on click", async () => {
    const user = userEvent.setup();
    render(<BoardCard item={reminderItem} smsReady onOpen={vi.fn()} />);

    expect(screen.getByText(/ready to send/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    expect(spies.dispatch).toHaveBeenCalledTimes(1);
  });

  it("carries the record's own idempotency key, so a double-click is one text", async () => {
    const user = userEvent.setup();
    render(<BoardCard item={reminderItem} smsReady onOpen={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /^send$/i }));
    expect(spies.dispatch).toHaveBeenCalledWith(lead.id, expect.any(String), "okq-e1-fu1");
  });

  it("sending does not also open the record behind the card", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<BoardCard item={reminderItem} smsReady onOpen={onOpen} />);

    await user.click(screen.getByRole("button", { name: /^send$/i }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  /**
   * BLOCKED, NOT DISABLED, and the reason is a visible line rather than a `title`. A tooltip does
   * not exist on a phone, and `disabled` takes the control out of the tab order — so the owner who
   * most needs the explanation (a screen-reader user) was the one who got none.
   */
  it("blocks Send when texting is not set up, without dropping it from the tab order", () => {
    render(<BoardCard item={reminderItem} smsReady={false} onOpen={vi.fn()} />);
    const send = screen.getByRole("button", { name: /^send$/i }) as HTMLButtonElement;
    expect(send.getAttribute("aria-disabled")).toBe("true");
    expect(send.disabled).toBe(false);
  });

  it("prints the reason on the card instead of hiding it in a tooltip", () => {
    render(<BoardCard item={reminderItem} smsReady={false} onOpen={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toMatch(/texting/i);
    expect(screen.getByRole("button", { name: /^send$/i }).title).toBe("");
  });

  it("states the caller's own reason — 'still checking' is not 'not set up'", () => {
    render(
      <BoardCard
        item={reminderItem}
        smsReady={false}
        smsBlockedReason="Checking texting setup…"
        onOpen={vi.fn()}
      />,
    );
    const send = screen.getByRole("button", { name: /^send$/i }) as HTMLButtonElement;
    expect(send.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Checking texting setup…");
  });

  it("shows the board's ✓ line instead of Send while the undo window is open", async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    render(
      <BoardCard
        item={reminderItem}
        smsReady
        onOpen={vi.fn()}
        send={{
          sent: { when: "8:47pm", secondsLeft: 26 },
          onSent: vi.fn(),
          onFailed: vi.fn(),
          onUndo,
        }}
      />,
    );

    expect(screen.queryByRole("button", { name: /^send$/i })).toBeNull();
    expect(screen.getByText(/✓ sent/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /undo · 26s/i }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("hands the commit's inverse to the board's ledger instead of dismissing itself", async () => {
    const user = userEvent.setup();
    const onSent = vi.fn();
    render(
      <BoardCard
        item={reminderItem}
        smsReady
        onOpen={vi.fn()}
        send={{ sent: null, onSent, onFailed: vi.fn(), onUndo: vi.fn() }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^send$/i }));
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(onSent.mock.calls[0]?.[0]).toBeTypeOf("function");
    // The board owns when the item leaves; the card must not pull it out from under itself.
    expect(spies.dismiss).not.toHaveBeenCalled();
  });

  it("keeps the draft visible when Send is blocked — the words are still the answer", () => {
    render(<BoardCard item={reminderItem} smsReady={false} onOpen={vi.fn()} />);
    expect(screen.getByText(/Hi Maria/)).toBeTruthy();
  });

  it("Change hands the owner the record rather than an inline editor", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<BoardCard item={reminderItem} smsReady onOpen={onOpen} />);

    await user.click(screen.getByRole("button", { name: /change/i }));
    expect(onOpen).toHaveBeenCalledWith(reminderItem);
  });

  it("renders no send block at all when there is nothing prepared", () => {
    render(<BoardCard item={jobItemFixture} smsReady onOpen={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^send$/i })).toBeNull();
  });

  it("un-sends and says why when the text never left — no ✓ over a message that failed", async () => {
    const user = userEvent.setup();
    const announced: WriteError[] = [];
    subscribeWriteErrors((e) => announced.push(e));
    spies.dispatch.mockImplementationOnce(() => Promise.reject(new Error("network down")));

    render(<BoardCard item={reminderItem} smsReady onOpen={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(announced).toHaveLength(1));
    expect(announced[0]?.tone).toBe("error");
    // The exact inverse of the commit ran, and the card is offering the text again.
    expect(spies.undo).toHaveBeenCalledTimes(1);
    expect(spies.undismiss).toHaveBeenCalledWith(ok.key);
    expect(screen.getByRole("button", { name: /^send$/i })).toBeTruthy();
    expect(screen.queryByText(/✓ sent/)).toBeNull();
  });
});

describe("BoardCard — the facts", () => {
  it("opens the right record modal per kind", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<BoardCard item={jobItemFixture} smsReady onOpen={onOpen} />);

    await user.click(screen.getByRole("button", { name: jobItemFixture.name }));
    expect(onOpen).toHaveBeenCalledWith(jobItemFixture);
  });

  it("states the money in mono, and NOTHING at all when the work is unpriced", () => {
    const { container, rerender } = render(
      <BoardCard item={item({ valueDollars: 2890 })} smsReady onOpen={vi.fn()} />,
    );
    expect(screen.getByText("$2,890")).toBeTruthy();
    expect(container.querySelector(".kval")?.className).toContain("fig");

    rerender(<BoardCard item={item({ valueDollars: 0 })} smsReady onOpen={vi.fn()} />);
    expect(screen.queryByText(/\$0/)).toBeNull();
    expect(container.querySelector(".kval")).toBeNull();
  });

  it("renders no service line when the row didn't carry one", () => {
    const { container } = render(<BoardCard item={item({ service: "" })} smsReady onOpen={vi.fn()} />);
    expect(container.querySelector(".kjob")).toBeNull();
  });

  it("colours the state badge by tone", () => {
    const tones = [
      { tone: "attention", cls: "amber" },
      { tone: "overdue", cls: "red" },
      { tone: "active", cls: "blue" },
      { tone: "waiting", cls: "gray" },
    ] as const;
    for (const t of tones) {
      const { container, unmount } = render(
        <BoardCard item={item({ tone: t.tone, ok: undefined })} smsReady onOpen={vi.fn()} />,
      );
      expect(container.querySelector(".pill")?.className).toContain(t.cls);
      unmount();
    }
  });

  it("keeps keyboard access to the record through a focusable child, not the card div", () => {
    const { container } = render(<BoardCard item={jobItemFixture} smsReady onOpen={vi.fn()} />);
    const card = container.querySelector(".kcard") as HTMLElement;
    expect(card.getAttribute("tabindex")).toBeNull();
    expect(card.getAttribute("role")).toBeNull();
    expect(card.querySelector("button.rowopen")).toBeTruthy();
  });
});
