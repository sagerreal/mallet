// @vitest-environment jsdom
/**
 * components/modals/thread-modal.test.tsx
 * The thread must never be a dead thread. Reached with a phoneless lead, it shows
 * an in-flow add-number prompt, disables the composer, and refuses to send (no
 * optimistic bubble that fails server-side) until a number is on file.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThreadModalContent } from "./thread-modal";

const h = vi.hoisted(() => ({
  leads: [] as { id: string; name: string; phone: string; acts?: unknown[] }[],
  updateLead: vi.fn(),
  sendMutate: vi.fn(() => Promise.resolve()),
  invalidate: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ id: "thread", params: { leadId: "lead-1" } }),
  useCloseModal: () => () => {},
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ leads: h.leads, updateLead: h.updateLead }),
}));

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { messaging: { listByLead: { invalidate: h.invalidate } } } }),
    v1: { messaging: { listByLead: { useQuery: () => ({ data: [], isLoading: false }) } } },
  },
}));

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: { v1: { messaging: { send: { mutate: h.sendMutate } } } },
}));

const updateLead = h.updateLead;
const sendMutate = h.sendMutate;

beforeEach(() => {
  vi.clearAllMocks();
  h.leads = [{ id: "lead-1", name: "Dana Alvarez", phone: "", acts: [] }];
});

describe("ThreadModalContent — phoneless reachability", () => {
  it("with NO phone: shows the add-number prompt and disables the composer send", () => {
    render(<ThreadModalContent />);
    expect(screen.getByLabelText(/No phone number yet/i)).toBeTruthy();
    const sendBtn = screen.getByText("Send") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
    // Sending is refused — no message goes to the wire.
    fireEvent.click(sendBtn);
    expect(sendMutate).not.toHaveBeenCalled();
  });

  it("with a phone: no add prompt and the composer send is enabled", () => {
    h.leads = [{ id: "lead-1", name: "Dana Alvarez", phone: "555-0101", acts: [] }];
    render(<ThreadModalContent />);
    expect(screen.queryByLabelText(/No phone number yet/i)).toBeNull();
    expect((screen.getByText("Send") as HTMLButtonElement).disabled).toBe(false);
  });

  it("saving a number persists it (composer then enables on the store update)", () => {
    render(<ThreadModalContent />);
    fireEvent.change(screen.getByLabelText(/No phone number yet/i), {
      target: { value: "(925) 555-0100" },
    });
    fireEvent.click(screen.getByText(/^Save/));
    expect(updateLead).toHaveBeenCalledWith("lead-1", { phone: "(925) 555-0100" });
  });
});
