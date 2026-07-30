// @vitest-environment jsdom
/**
 * components/modals/evisit-modal.test.tsx
 *
 * Guards against the collapsed-sheet defect found in the mobile triage: opening
 * MODAL.EVISIT with stale/mismatched params (a removed visit, or a lead that no
 * longer carries it) used to `return null` from EvisitModalContent while the
 * Modal shell (rendered by modal-host, not by this component) was already open —
 * the user saw a bare grabber + ✕ with no explanation. It must now say why
 * instead of rendering nothing.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvisitModalContent } from "./evisit-modal";

let activeParams: Record<string, string> = {};

const LEAD_ID = "lead-1";
const VISIT_ID = "visit-1";
const LEAD = {
  id: LEAD_ID,
  name: "Real Customer",
  evisits: [{ id: VISIT_ID, date: null, techId: null, start: null, dur: 1, status: "scheduled" }],
  archived: false,
  trash: false,
};

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ params: activeParams }),
  useCloseModal: () => vi.fn(),
  useOpenModal: () => vi.fn(),
  usePushModal: () => vi.fn(),
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      leads: [LEAD],
      jobs: [],
      techs: [],
      updateLead: vi.fn(),
    }),
}));

describe("EvisitModalContent — param resolution", () => {
  it("renders the visit when leadId/visitId resolve to a real evisit", () => {
    activeParams = { leadId: LEAD_ID, visitId: VISIT_ID };
    render(<EvisitModalContent />);
    expect(screen.getByText("Real Customer")).toBeTruthy();
    expect(screen.getAllByText("Estimate visit").length).toBeGreaterThan(0);
  });

  it("says why instead of rendering a bare sheet when the visit no longer exists", () => {
    activeParams = { leadId: "does-not-exist", visitId: "does-not-exist" };
    render(<EvisitModalContent />);
    expect(screen.getByText(/visit not found/i)).toBeTruthy();
    expect(screen.queryByText("Real Customer")).toBeNull();
  });

  it("says why when the leadId is real but the visitId no longer belongs to it", () => {
    activeParams = { leadId: LEAD_ID, visitId: "removed-visit" };
    render(<EvisitModalContent />);
    expect(screen.getByText(/visit not found/i)).toBeTruthy();
  });
});
