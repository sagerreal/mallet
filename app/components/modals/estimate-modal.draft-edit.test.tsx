// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * A draft quote must be editable.
 *
 * It was the only status that could not be changed: a SENT quote offered "Edit & resend", an
 * accepted or declined one is a record, and a draft — the one state where changing the price is
 * the obvious next move — offered only "Send quote" and "Delete quote". Owen opened EST-2024,
 * a $625 draft, and had no way to touch the number.
 */

const push = vi.fn();
const close = vi.fn();

let estimate: Record<string, unknown>;

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      estimates: [estimate],
      leads: [{ id: "lead-1", name: "Tom Mackey", phone: "+19255550122", archived: false }],
      jobs: [],
      techs: [],
      brand: { name: "Summit Plumbing" },
      settings: {},
      adoptEstimate: vi.fn(),
      updateEstimate: vi.fn(),
      deleteEstimate: vi.fn(),
      sendEstimate: vi.fn(),
      moveLeadStage: vi.fn(),
    }),
  useActiveModal: () => ({ id: "EST", params: { estId: "est-1" } }),
  useCloseModal: () => close,
  usePushModal: () => vi.fn(),
  useOpenModal: () => vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      // The sheet header's record trail. Undefined data renders nothing, which is what these tests
      // want — they are about the sheet's own body, not the chain.
      links: { forRecord: { useQuery: () => ({ data: undefined }) } },
      quoting: {
        get: { useQuery: () => ({ data: undefined, isLoading: false, isError: false }) },
        clearChangeRequest: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      },
      messaging: { send: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) } },
      notifications: { send: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) } },
    },
  },
}));

import { EstimateModalContent } from "./estimate-modal";

const draft = () => ({
  id: "est-1",
  num: "EST-2024",
  leadId: "lead-1",
  title: "Water heater replacement",
  status: "draft",
  age: 1,
  viewed: false,
  fu: { on: false, stage: 0 },
  lines: [{ d: "Water heater replacement", q: 1, r: 625 }],
  archived: false,
  trash: false,
  reads: [],
});

describe("a draft quote", () => {
  beforeEach(() => {
    estimate = draft();
    vi.clearAllMocks();
  });

  it("offers a way to edit it", () => {
    render(<EstimateModalContent />);
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("still offers Send — editing is beside it, not instead of it", () => {
    render(<EstimateModalContent />);
    expect(screen.getByRole("button", { name: /send quote/i })).toBeTruthy();
  });

  it("Edit opens the composer seeded with this quote, and closes the sheet", () => {
    render(<EstimateModalContent />);
    screen.getByRole("button", { name: "Edit" }).click();
    expect(push).toHaveBeenCalledWith("/composer?revise=est-1");
    expect(close).toHaveBeenCalled();
  });
});
