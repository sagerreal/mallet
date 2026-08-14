// @vitest-environment jsdom
/**
 * app/(office)/composer/save-draft.test.tsx
 *
 * "Save draft" is the composer's other terminal action, and it used to assert success before it
 * had any: it fired an optimistic store write and redirected to /dashboard in the same tick, so
 * a payload the server refused (a discount over 10000 bps, a dropped connection) rolled back a
 * record nobody was looking at any more — the quote was simply gone, with the app reporting a
 * save.
 *
 * It also drafted a SECOND estimate on top of any Preview drafts from the same session. Preview
 * has to persist to mint a public token; the send path already archives those once it supersedes
 * them, and the save path now does the same.
 *
 * Sub-components are stubbed as in page.test.tsx; SendCard is stubbed down to the two actions
 * and the error slot so this file tests ComposerPage's own persistence wiring.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
  useSearchParams: () => ({ get: (k: string) => (k === "job" ? "job-1" : null) }),
}));

const adoptEstimate = vi.fn();
const addEstimate = vi.fn();
vi.mock("@/lib/store/app-store", () => ({
  useLeads: () => [{ id: "lead-42", name: "Dana Alvarez", job: "Water heater swap", phone: "+19255550100" }],
  usePushModal: () => vi.fn(),
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      jobs: [],
      addEstimate,
      adoptEstimate,
      moveLeadStage: vi.fn(),
      addLeadNote: vi.fn(),
      services: [],
      laborRates: [],
      updateService: vi.fn(),
    }),
}));

const draftMutateAsync = vi.fn();
const archiveMutate = vi.fn();
vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { customers: { list: { invalidate: vi.fn() } } } }),
    v1: {
      quoting: {
        buildFromMeasurements: {
          useQuery: () => ({
            data: {
              leadId: "lead-42",
              seedLines: [
                { description: "Water heater swap", quantity: 1, rateCents: 100_000, costCents: 0 },
              ],
              gaps: [],
              unconfirmedRooms: [],
            },
            isError: false,
          }),
        },
        draft: { useMutation: () => ({ mutateAsync: draftMutateAsync }) },
        get: { useQuery: () => ({ data: undefined, isError: false }) },
        send: { useMutation: () => ({ mutateAsync: vi.fn() }) },
        archive: { useMutation: () => ({ mutate: archiveMutate }) },
        rules: { create: { useMutation: () => ({ mutate: vi.fn() }) } },
      },
      settings: { get: { useQuery: () => ({ data: undefined }) } },
      messaging: { send: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
      notifications: { send: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
      customers: { create: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) } },
      ai: {
        gatherJobContext: { useQuery: () => ({ data: undefined }) },
        draftEstimate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        draftEstimateTiers: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
    },
  },
}));

vi.mock("./customer-selector", () => ({ CustomerSelector: () => null }));
vi.mock("./quote-card", () => ({ QuoteCard: () => null }));
vi.mock("./pricing-card", () => ({ PricingCard: () => null }));
vi.mock("./measured-surfaces-panel", () => ({ MeasuredSurfacesPanel: () => null }));
vi.mock("./message-card", () => ({ MessageCard: () => null }));
vi.mock("./send-card", () => ({
  SendCard: ({
    sendError,
    onPreview,
    onSaveDraft,
  }: {
    sendError: string | null;
    onPreview: () => void;
    onSaveDraft: () => void;
  }) => (
    <>
      <button onClick={onPreview}>Preview</button>
      <button onClick={onSaveDraft}>Save draft</button>
      {sendError ? <div role="alert">{sendError}</div> : null}
    </>
  ),
}));

import ComposerPage from "./page";

const draftDto = (over: Record<string, unknown> = {}) => ({
  id: "est-1",
  num: "Q-1041",
  publicToken: "tok-1",
  status: "draft",
  ...over,
});

beforeEach(() => {
  routerPush.mockClear();
  adoptEstimate.mockClear();
  addEstimate.mockClear();
  draftMutateAsync.mockReset();
  archiveMutate.mockClear();
  window.open = vi.fn();
});

describe("ComposerPage — Save draft", () => {
  it("persists the draft and lands on the board once the server has it", async () => {
    draftMutateAsync.mockResolvedValue(draftDto());
    render(<ComposerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/dashboard"));
    expect(draftMutateAsync).toHaveBeenCalledTimes(1);
    // The server already holds it — adopt the returned record instead of drafting a second one.
    expect(adoptEstimate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "est-1" }),
      { on: true, stage: 0 },
    );
    expect(addEstimate).not.toHaveBeenCalled();
  });

  it("stays on the quote and names the failure when the save is refused", async () => {
    draftMutateAsync.mockRejectedValue(new Error("discount must be between 0 and 10000 bps"));
    render(<ComposerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/not saved/i);
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("archives the session's preview drafts instead of leaving them in the ledger", async () => {
    draftMutateAsync.mockResolvedValueOnce(draftDto({ id: "prev-1", publicToken: "tok-prev" }));
    render(<ComposerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(draftMutateAsync).toHaveBeenCalledTimes(1));

    draftMutateAsync.mockResolvedValueOnce(draftDto());
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/dashboard"));

    expect(archiveMutate).toHaveBeenCalledWith(
      { estimateId: "prev-1" },
      expect.anything(),
    );
  });

  it("leaves the preview draft alone when the save it was superseded by fails", async () => {
    draftMutateAsync.mockResolvedValueOnce(draftDto({ id: "prev-1", publicToken: "tok-prev" }));
    render(<ComposerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(draftMutateAsync).toHaveBeenCalledTimes(1));

    draftMutateAsync.mockRejectedValueOnce(new Error("nope"));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    expect(archiveMutate).not.toHaveBeenCalled();
  });
});
