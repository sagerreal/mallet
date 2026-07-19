// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Estimate } from "@/lib/store/types";

interface Store {
  estimates: Estimate[];
  leads: { id: string; name: string }[];
  updateEstimate: () => void;
  deleteEstimate: () => void;
  restoreEstimate: (id: string) => void;
}
let storeState: Store;
const restoreEstimate = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Store) => unknown) => sel(storeState),
  useCloseModal: () => vi.fn(),
}));

import { QuoteSweepModalContent } from "./quote-sweep-modal";

const est = (over: Partial<Estimate>): Estimate =>
  ({ id: "e1", num: "Q-1001", title: "Water heater", leadId: "L1", status: "sent", lines: [], archived: false, ...over } as unknown as Estimate);

describe("QuoteSweepModal — archived quotes restore here (Settings Archive tab retired)", () => {
  beforeEach(() => {
    storeState = {
      estimates: [est({}), est({ id: "e2", num: "Q-1002", title: "Repipe", archived: true })],
      leads: [{ id: "L1", name: "Ada" }],
      updateEstimate: vi.fn(), deleteEstimate: vi.fn(), restoreEstimate,
    };
    vi.clearAllMocks();
  });

  it("lists archived quotes in their own group with a Restore action", () => {
    render(<QuoteSweepModalContent />);
    expect(screen.getByText(/Archived — 1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore Q-1002" }));
    expect(restoreEstimate).toHaveBeenCalledWith("e2");
  });

  it("shows no Archived group when nothing is archived", () => {
    storeState.estimates = [est({})];
    render(<QuoteSweepModalContent />);
    expect(screen.queryByText(/Archived —/)).toBeNull();
  });
});
