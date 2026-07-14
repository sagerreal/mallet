// @vitest-environment jsdom
/**
 * components/modals/call-modal.test.tsx
 * The call sheet must never open a blank call bar. Reached with a phoneless lead
 * (any opener), it shows an in-flow add-number prompt instead of the "Call from
 * Mallet" path, and startCall is not fired until a number is saved.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CallModalContent } from "./call-modal";

let mockLeads: { id: string; name: string; phone: string }[] = [];
const startCall = vi.fn(() => true);
const updateLead = vi.fn();
const addLeadNote = vi.fn();
const close = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ id: "call", params: { leadId: "lead-1" } }),
  useCloseModal: () => close,
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ leads: mockLeads, startCall, updateLead, addLeadNote }),
}));

vi.mock("@/lib/store/call-constants", () => ({ CALL_OUTCOMES: ["Connected", "Voicemail"] }));

beforeEach(() => {
  vi.clearAllMocks();
  startCall.mockReturnValue(true);
  mockLeads = [{ id: "lead-1", name: "Dana Alvarez", phone: "" }];
});

describe("CallModalContent — phoneless reachability", () => {
  it("with a phone: shows the 'Call from Mallet' path and starts the call", () => {
    mockLeads = [{ id: "lead-1", name: "Dana Alvarez", phone: "555-0101" }];
    render(<CallModalContent />);
    expect(screen.getByText("Call from Mallet")).toBeTruthy();
    fireEvent.click(screen.getByText("Call from Mallet"));
    expect(startCall).toHaveBeenCalledWith("lead-1");
    expect(close).toHaveBeenCalled();
  });

  it("with NO phone: hides the call path, shows the add-number prompt, does not start a blank call", () => {
    render(<CallModalContent />);
    expect(screen.queryByText("Call from Mallet")).toBeNull();
    expect(screen.getByLabelText(/Add a phone number to call them/i)).toBeTruthy();
    // No blank call bar opened.
    expect(startCall).not.toHaveBeenCalled();
  });

  it("saving a number persists it and starts the call with the fresh value", () => {
    render(<CallModalContent />);
    fireEvent.change(screen.getByLabelText(/Add a phone number to call them/i), {
      target: { value: "(925) 555-0100" },
    });
    fireEvent.click(screen.getByText("Save"));
    expect(updateLead).toHaveBeenCalledWith("lead-1", { phone: "(925) 555-0100" });
    expect(startCall).toHaveBeenCalledWith("lead-1");
    expect(close).toHaveBeenCalled();
  });
});
