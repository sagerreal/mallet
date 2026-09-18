// @vitest-environment jsdom
/**
 * components/modals/thread-modal.test.tsx
 * The thread must never be a dead thread. Reached with a phoneless lead, it shows
 * an in-flow add-number prompt, disables the composer, and refuses to send (no
 * optimistic bubble that fails server-side) until a number is on file.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SMS_BODY_MAX_CHARS } from "@mallet/shared/messaging/sms-limits";
import { ThreadModalContent } from "./thread-modal";

const h = vi.hoisted(() => ({
  leads: [] as { id: string; name: string; phone: string; acts?: unknown[] }[],
  params: { leadId: "lead-1" } as Record<string, unknown>,
  updateLead: vi.fn(),
  clearLeadUnreadLocal: vi.fn(),
  sendMutate: vi.fn(() => Promise.resolve()),
  markReadMutate: vi.fn(() => Promise.resolve({ cleared: true })),
  invalidate: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ id: "thread", params: h.params }),
  useCloseModal: () => () => {},
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    // a2pStatus is what useSmsGate reads to decide whether Send is blocked. `active` here so the
    // thread's own tests exercise a shop that CAN text; the blocked shape is covered in
    // features/a2p/use-sms-ready.test.tsx and sms-blocked.test.tsx.
    selector({
      leads: h.leads,
      updateLead: h.updateLead,
      clearLeadUnreadLocal: h.clearLeadUnreadLocal,
      a2pStatus: { status: "active", canText: true, needsInput: false, failureReason: null },
    }),
}));

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      v1: {
        messaging: {
          listByLead: { invalidate: h.invalidate },
          listConversations: { invalidate: h.invalidate },
        },
      },
    }),
    v1: { messaging: { listByLead: { useQuery: () => ({ data: [], isLoading: false }) } } },
  },
}));

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      messaging: {
        send: { mutate: h.sendMutate },
        markThreadRead: { mutate: h.markReadMutate },
      },
    },
  },
}));

const updateLead = h.updateLead;
const sendMutate = h.sendMutate;

beforeEach(() => {
  vi.clearAllMocks();
  h.params = { leadId: "lead-1" };
  h.leads = [{ id: "lead-1", name: "Dana Alvarez", phone: "", acts: [] }];
});

describe("ThreadModalContent — phoneless reachability", () => {
  it("with NO phone: the sheet IS the add-number ask — no dead composer under it", () => {
    render(<ThreadModalContent />);
    // The state lives in the head's meta line; the field carries a plain label.
    expect(screen.getByText("No phone number yet")).toBeTruthy();
    expect(screen.getByLabelText("Mobile number")).toBeTruthy();
    // The composer does not render at all — a disabled Send was a dead control,
    // and an empty thread under the ask said nothing.
    expect(screen.queryByText("Send")).toBeNull();
    expect(screen.queryByText("No messages yet")).toBeNull();
    expect(sendMutate).not.toHaveBeenCalled();
  });

  it("with a phone: no add prompt and the composer send is enabled", () => {
    h.leads = [{ id: "lead-1", name: "Dana Alvarez", phone: "555-0101", acts: [] }];
    render(<ThreadModalContent />);
    expect(screen.queryByLabelText("Mobile number")).toBeNull();
    expect((screen.getByText("Send") as HTMLButtonElement).disabled).toBe(false);
  });

  it("saving a number persists it (the thread then takes over on the store update)", () => {
    render(<ThreadModalContent />);
    fireEvent.change(screen.getByLabelText("Mobile number"), {
      target: { value: "(925) 555-0100" },
    });
    fireEvent.click(screen.getByText(/^Save/));
    expect(updateLead).toHaveBeenCalledWith("lead-1", { phone: "(925) 555-0100" });
  });
});

/**
 * The tech shell has NO leads store (the customers hydrator is office-only), so the modal
 * renders from the params the field openers pass — and never shows a save button a tech's
 * role cannot honour.
 */
describe("ThreadModalContent — field shell (no store lead)", () => {
  it("renders header, phone line, and live composer from params alone", () => {
    h.leads = [];
    h.params = { leadId: "lead-1", leadName: "Marcus Reyes", phone: "+15555550123" };
    render(<ThreadModalContent />);
    expect(screen.getByText("Marcus Reyes")).toBeTruthy();
    expect(screen.getByPlaceholderText("Text Marcus…")).toBeTruthy();
  });

  it("phoneless with no store lead: the ask routes to the office, no dead save control", () => {
    h.leads = [];
    h.params = { leadId: "lead-1", leadName: "Marcus Reyes", phone: null };
    render(<ThreadModalContent />);
    expect(screen.getByText(/ask the office to add one/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });
});

describe("ThreadModalContent — read state", () => {
  it("opening clears unread locally AND through the role-aware endpoint (never customers.update)", () => {
    h.leads = [{ id: "lead-1", name: "Dana Alvarez", phone: "+15555550123", acts: [] }];
    render(<ThreadModalContent />);
    expect(h.clearLeadUnreadLocal).toHaveBeenCalledWith("lead-1");
    expect(h.markReadMutate).toHaveBeenCalledWith({ leadId: "lead-1" });
    expect(h.updateLead).not.toHaveBeenCalled();
  });
});

/**
 * A send can be refused for reasons that have nothing to do with the phone number — the commonest
 * being a body over the carrier's 1600-character limit. The composer mapped EVERY BAD_REQUEST to
 * "This customer has no phone number on file", which the header contradicts two lines above with
 * the number itself. The server's own sentence is the only thing that names the real cause.
 */
describe("ThreadModalContent — a refused send says why", () => {
  const withPhone = () => {
    h.leads = [{ id: "lead-1", name: "Dana Alvarez", phone: "+15555550123", acts: [] }];
  };

  const refuseWith = (code: string, message: string) => {
    h.sendMutate.mockRejectedValueOnce(Object.assign(new Error(message), { name: "TRPCClientError", data: { code } }));
  };

  const typeAndSend = (text: string) => {
    fireEvent.change(screen.getByPlaceholderText("Text Dana…"), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  };

  it("does not blame the phone number for a length rejection", async () => {
    withPhone();
    refuseWith("BAD_REQUEST", "Body is too long — 1600 characters maximum.");
    render(<ThreadModalContent />);

    typeAndSend("hello");

    expect(await screen.findByText("Body is too long — 1600 characters maximum.")).toBeTruthy();
    expect(screen.queryByText(/no phone number on file/i)).toBeNull();
  });

  it("still falls back to plain copy when the server wrote no sentence", async () => {
    withPhone();
    refuseWith("BAD_GATEWAY", "boom");
    render(<ThreadModalContent />);

    typeAndSend("hello");

    expect(await screen.findByText(/couldn.t send/i)).toBeTruthy();
  });

  it("caps the composer at the carrier limit so the refusal is unreachable", () => {
    withPhone();
    render(<ThreadModalContent />);

    expect(screen.getByPlaceholderText("Text Dana…").getAttribute("maxLength")).toBe(String(SMS_BODY_MAX_CHARS));
  });

  it("counts down only once the limit is close enough to matter", () => {
    withPhone();
    render(<ThreadModalContent />);
    const box = screen.getByPlaceholderText("Text Dana…");

    fireEvent.change(box, { target: { value: "hello" } });
    expect(screen.queryByText(/characters left/i)).toBeNull();

    fireEvent.change(box, { target: { value: "x".repeat(SMS_BODY_MAX_CHARS - 40) } });
    expect(screen.getByText("40 characters left")).toBeTruthy();
  });
});
