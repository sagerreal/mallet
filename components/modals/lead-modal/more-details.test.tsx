// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Lead } from "@/lib/store/types";

const deleteLead = vi.fn();
const closeModal = vi.fn();
const updateLead = vi.fn();
const openModal = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { updateLead: unknown; deleteLead: unknown }) => unknown) =>
    sel({ updateLead, deleteLead }),
  useOpenModal: () => openModal,
  useCloseModal: () => closeModal,
}));

import { MoreDetails } from "./more-details";

const lead = { id: "L1", name: "Sarah Friday", email: "", card: "", archived: false } as unknown as Lead;

describe("MoreDetails delete — in-app arm-then-confirm that archives", () => {
  beforeEach(() => vi.clearAllMocks());

  it("first click ARMS the control (nothing deleted yet) and shows honest, recoverable copy", () => {
    render(<MoreDetails lead={lead} />);
    fireEvent.click(screen.getByRole("button", { name: /^Delete Sarah Friday$/i }));
    expect(deleteLead).not.toHaveBeenCalled();
    expect(closeModal).not.toHaveBeenCalled();
    // No false "cannot be undone"; the armed copy tells the truth (archives, recoverable).
    expect(screen.getByText(/archives, recoverable/i)).toBeTruthy();
    expect(screen.queryByText(/cannot be undone/i)).toBeNull();
  });

  it("second click confirms — archives the lead and closes the modal", () => {
    render(<MoreDetails lead={lead} />);
    fireEvent.click(screen.getByRole("button", { name: /^Delete Sarah Friday$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm — archive Sarah Friday/i }));
    expect(deleteLead).toHaveBeenCalledWith("L1");
    expect(closeModal).toHaveBeenCalledTimes(1);
  });

  it("never triggers a native browser confirm() dialog", () => {
    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    render(<MoreDetails lead={lead} />);
    fireEvent.click(screen.getByRole("button", { name: /^Delete Sarah Friday$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm — archive/i }));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
