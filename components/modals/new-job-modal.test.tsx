// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NewJobModalContent } from "./new-job-modal";

// Store actions captured so the test can assert ordering (create → then evisit patch).
const addLead = vi.fn();
const updateLead = vi.fn();
const addJob = vi.fn();
const addVisit = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useCloseModal: () => vi.fn(),
  useOpenModal: () => vi.fn(),
  useLeads: () => [],
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ addLead, updateLead, addJob, addVisit }),
}));

describe("NewJobModalContent — createEstimate", () => {
  beforeEach(() => {
    addLead.mockReset();
    updateLead.mockReset();
  });

  it("awaits the persisted lead, then attaches the evisit to the SERVER id", async () => {
    // addLead returns an optimistic id but persists to a different server id.
    addLead.mockReturnValue({
      lead: { id: "optimistic-1", name: "New customer", evisits: [] },
      persisted: Promise.resolve({ id: "srv-1", name: "New customer", evisits: [] }),
    });

    render(<NewJobModalContent />);
    // Fill "What's the job?" and pick the Estimate type.
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "water heater" },
    });
    fireEvent.click(screen.getByText("Estimate"));
    fireEvent.submit(screen.getByText("Create job").closest("form")!);

    expect(addLead).toHaveBeenCalledOnce();
    // The evisit patch must land on the reconciled server id, not the optimistic one.
    await waitFor(() => {
      expect(updateLead).toHaveBeenCalledOnce();
    });
    const [id, patch] = updateLead.mock.calls[0] as [string, { evisits: unknown[] }];
    expect(id).toBe("srv-1");
    expect(patch.evisits).toHaveLength(1);
  });
});
