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
let mockMe: { role: string; callbackNumber: string | null } = {
  role: "owner",
  callbackNumber: "+17813850591",
};
const startCall = vi.fn(() => true);
const updateLead = vi.fn();
const addLeadNote = vi.fn();
const close = vi.fn();

vi.mock("@/features/identity/hooks", () => ({ useMe: () => ({ data: mockMe }) }));

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
  mockMe = { role: "owner", callbackNumber: "+17813850591" };
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
    expect(screen.getByLabelText(/No phone number yet/i)).toBeTruthy();
    // No blank call bar opened.
    expect(startCall).not.toHaveBeenCalled();
  });

  it("saving a number persists it and starts the call with the fresh value", () => {
    render(<CallModalContent />);
    fireEvent.change(screen.getByLabelText(/No phone number yet/i), {
      target: { value: "(925) 555-0100" },
    });
    fireEvent.click(screen.getByText(/^Save/));
    expect(updateLead).toHaveBeenCalledWith("lead-1", { phone: "(925) 555-0100" });
    expect(startCall).toHaveBeenCalledWith("lead-1");
    expect(close).toHaveBeenCalled();
  });
});

/**
 * Mallet rings the CALLER's own phone first, so a call is impossible until that number is on file.
 * The modal must say so up front: the refusal otherwise arrives after the modal has closed, in the
 * global call bar, phrased as an instruction with nowhere to carry it out.
 */
describe("CallModalContent — no callback number on file", () => {
  beforeEach(() => {
    mockLeads = [{ id: "lead-1", name: "Dana Alvarez", phone: "555-0101" }];
    mockMe = { role: "owner", callbackNumber: null };
  });

  it("does not place a call, and names the fix", () => {
    render(<CallModalContent />);
    fireEvent.click(screen.getByText("Call from Mallet"));
    expect(startCall).not.toHaveBeenCalled();
    expect(screen.getByText(/needs a number to ring you on/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /add your mobile/i }).getAttribute("href")).toBe("/settings");
  });

  it("sends a technician to their own account page, which is the only settings surface they have", () => {
    mockMe = { role: "tech", callbackNumber: null };
    render(<CallModalContent />);
    fireEvent.click(screen.getByText("Call from Mallet"));
    expect(screen.getByRole("link", { name: /add your mobile/i }).getAttribute("href")).toBe("/account");
  });

  it("keeps 'Log a call' working — recording a past call needs no callback number", () => {
    render(<CallModalContent />);
    fireEvent.click(screen.getByText("Log a call"));
    expect(screen.getByText("How did it go?")).toBeTruthy();
  });

  it("adding the customer's number does not sneak past the missing callback number", () => {
    mockLeads = [{ id: "lead-1", name: "Dana Alvarez", phone: "" }];
    render(<CallModalContent />);
    fireEvent.change(screen.getByLabelText(/No phone number yet/i), {
      target: { value: "(925) 555-0100" },
    });
    fireEvent.click(screen.getByText(/^Save/));
    expect(updateLead).toHaveBeenCalledWith("lead-1", { phone: "(925) 555-0100" });
    expect(startCall).not.toHaveBeenCalled();
    // …and it says why, rather than appearing to do nothing.
    expect(screen.getByText(/needs a number to ring you on/i)).toBeTruthy();
  });
});
