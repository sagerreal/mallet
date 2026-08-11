// @vitest-environment jsdom
/**
 * components/modals/call-modal.test.tsx
 * The call sheet must never open a blank call bar. Reached with a phoneless lead
 * (any opener), it shows an in-flow add-number prompt instead of the "Call from
 * Mallet" path, and startCall is not fired until a number is saved.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CallModalContent } from "./call-modal";

let mockLeads: { id: string; name: string; phone: string }[] = [];
let mockMe: { role: string; callbackNumber: string | null } = {
  role: "owner",
  callbackNumber: "+17813850591",
};
const startCall = vi.fn(() => true);
// Resolves TRUE like the real action: durable. Overridden per-test to model a failed save.
const updateLead = vi.fn(async () => true);
const addLeadNote = vi.fn();
const close = vi.fn();

vi.mock("@/features/identity/hooks", () => ({ useMe: () => ({ data: mockMe }) }));

// jsdom has no WebRTC, so the real predicate would answer "no" anyway — mocked so each test can
// state which transport it is exercising rather than depending on the environment.
let browserCanCarry = false;
vi.mock("@/lib/calls/browser-device", () => ({ browserCallingSupported: () => browserCanCarry }));

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
  browserCanCarry = false;
});

describe("CallModalContent — phoneless reachability", () => {
  it("with a phone: shows the 'Call from Mallet' path and starts the call", () => {
    mockLeads = [{ id: "lead-1", name: "Dana Alvarez", phone: "555-0101" }];
    render(<CallModalContent />);
    expect(screen.getByText("Call from Mallet")).toBeTruthy();
    fireEvent.click(screen.getByText("Call from Mallet"));
    expect(startCall).toHaveBeenCalledWith("lead-1", "phone");
    expect(close).toHaveBeenCalled();
  });

  it("with NO phone: hides the call path, shows the add-number prompt, does not start a blank call", () => {
    render(<CallModalContent />);
    expect(screen.queryByText("Call from Mallet")).toBeNull();
    expect(screen.getByLabelText("Mobile number")).toBeTruthy();
    // No blank call bar opened.
    expect(startCall).not.toHaveBeenCalled();
  });

  it("saving a number persists it and starts the call with the fresh value", async () => {
    render(<CallModalContent />);
    fireEvent.change(screen.getByLabelText("Mobile number"), {
      target: { value: "(925) 555-0100" },
    });
    fireEvent.click(screen.getByText(/^Save/));
    expect(updateLead).toHaveBeenCalledWith("lead-1", { phone: "(925) 555-0100" });
    await waitFor(() => expect(startCall).toHaveBeenCalledWith("lead-1", "phone"));
    expect(close).toHaveBeenCalled();
  });

  /**
   * The bug this locks: the call used to start on the OPTIMISTIC store write, but `place` runs on
   * the server and reads the customer from the database. The call raced the save it depended on
   * and lost — the server refused a number the user had just typed in with "this customer has no
   * phone number on file".
   */
  it("waits for the number to be durable before placing the call", async () => {
    let settle: (durable: boolean) => void = () => {};
    updateLead.mockReturnValueOnce(new Promise<boolean>((res) => { settle = res; }));

    render(<CallModalContent />);
    fireEvent.change(screen.getByLabelText("Mobile number"), {
      target: { value: "(925) 555-0100" },
    });
    fireEvent.click(screen.getByText(/^Save/));

    // Still saving: no call yet, and the button says so and refuses a second press.
    await screen.findByText(/Saving the number/i);
    expect(startCall).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/Saving the number/i));

    settle(true);
    await waitFor(() => expect(startCall).toHaveBeenCalledTimes(1));
  });

  it("does not place a call when the number failed to save, and says so", async () => {
    updateLead.mockResolvedValueOnce(false);
    render(<CallModalContent />);
    fireEvent.change(screen.getByLabelText("Mobile number"), {
      target: { value: "(925) 555-0100" },
    });
    fireEvent.click(screen.getByText(/^Save/));

    await screen.findByText(/didn't save, so the call can't go out/i);
    expect(startCall).not.toHaveBeenCalled();
  });
});

// When the browser can be the phone, it is: no handset rings and no callback number is needed,
// because the microphone is the leg.
describe("CallModalContent — this browser can carry the call", () => {
  beforeEach(() => {
    browserCanCarry = true;
    mockLeads = [{ id: "lead-1", name: "Dana Alvarez", phone: "555-0101" }];
  });

  it("calls through the browser, with no number on file", () => {
    mockMe = { role: "owner", callbackNumber: null };
    render(<CallModalContent />);
    fireEvent.click(screen.getByText("Call from Mallet"));
    expect(startCall).toHaveBeenCalledWith("lead-1", "browser");
    expect(close).toHaveBeenCalled();
  });

  it("says the call happens here, not on a handset", () => {
    render(<CallModalContent />);
    expect(screen.getByText(/through this computer/i)).toBeTruthy();
    expect(screen.queryByText(/rings/i)).toBeNull();
  });

  it("never asks for a callback number it does not need", () => {
    mockMe = { role: "owner", callbackNumber: null };
    render(<CallModalContent />);
    fireEvent.click(screen.getByText("Call from Mallet"));
    expect(screen.queryByText(/needs a number to ring you on/i)).toBeNull();
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

  it("adding the customer's number does not sneak past the missing callback number", async () => {
    mockLeads = [{ id: "lead-1", name: "Dana Alvarez", phone: "" }];
    render(<CallModalContent />);
    fireEvent.change(screen.getByLabelText("Mobile number"), {
      target: { value: "(925) 555-0100" },
    });
    fireEvent.click(screen.getByText(/^Save/));
    expect(updateLead).toHaveBeenCalledWith("lead-1", { phone: "(925) 555-0100" });
    await screen.findByText(/needs a number to ring you on/i);
    expect(startCall).not.toHaveBeenCalled();
  });
});
