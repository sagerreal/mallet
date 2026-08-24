// @vitest-environment jsdom
/**
 * features/artie/autonomy-row.test.tsx
 * Proves the four behaviours the brief names by name: the live value renders, an owner's pick
 * saves, a non-owner sees the picker disabled with a plain reason (never hidden), and a refused
 * save surfaces the server's FORBIDDEN sentence verbatim rather than the generic role copy.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { getQuery, meQuery, updateMutate, invalidate } = vi.hoisted(() => ({
  getQuery: vi.fn(),
  meQuery: vi.fn(),
  updateMutate: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { settings: { get: { invalidate } } } }),
    v1: {
      settings: {
        get: { useQuery: () => getQuery() },
        updateConfig: { useMutation: () => ({ mutate: updateMutate, isPending: false }) },
      },
      identity: {
        me: { useQuery: () => meQuery() },
      },
    },
  },
}));

import { AutonomyRow } from "./autonomy-row";

const settingsResult = (agentAutonomy: string) => ({
  data: { config: { agentAutonomy } },
  isFetched: true,
});

const meResult = (role: string) => ({ data: { role }, isFetched: true });

const open = (): void => {
  fireEvent.click(screen.getByText("What Artie may do"));
};

describe("AutonomyRow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the live level and all three levels' consequences", () => {
    getQuery.mockReturnValue(settingsResult("assisted"));
    meQuery.mockReturnValue(meResult("owner"));
    render(<AutonomyRow />);

    expect(screen.getByText("Assisted", { selector: ".val" })).toBeTruthy();
    open();
    expect(screen.getByText(/Artie drafts everything and waits for your OK/)).toBeTruthy();
    expect(screen.getByText(/Artie sends routine replies and books work on its own/)).toBeTruthy();
    // Autonomous's copy must not promise initiative that does not exist: routines/triggers (the
    // only thing that would let Artie act "on its own initiative" or "open its own follow-ups")
    // are deferred, and AUTO_APPROVED.autonomous is byte-identical to .assisted today. A security
    // review caught the old copy claiming otherwise — this must stay honest about today, not
    // silently regress back to promising work the settings row cannot yet do.
    expect(screen.getByText(/the same as Assisted/)).toBeTruthy();
    expect(screen.queryByText(/own initiative/)).toBeNull();
    expect(screen.queryByText(/opens its own follow-ups/)).toBeNull();
  });

  it("saves the level an owner picks", () => {
    getQuery.mockReturnValue(settingsResult("supervised"));
    meQuery.mockReturnValue(meResult("owner"));
    render(<AutonomyRow />);
    open();

    fireEvent.click(screen.getByRole("button", { name: "Assisted" }));

    expect(updateMutate).toHaveBeenCalledWith(
      { agentAutonomy: "assisted" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it("does not save when the picked level is already the live one", () => {
    getQuery.mockReturnValue(settingsResult("supervised"));
    meQuery.mockReturnValue(meResult("owner"));
    render(<AutonomyRow />);
    open();

    fireEvent.click(screen.getByRole("button", { name: "Supervised" }));

    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("disables the picker for a non-owner, with a plain reason shown rather than hiding it", () => {
    getQuery.mockReturnValue(settingsResult("supervised"));
    meQuery.mockReturnValue(meResult("office"));
    render(<AutonomyRow />);
    open();

    // Present, not gone: a control that vanishes reads as broken.
    expect((screen.getByRole("button", { name: "Assisted" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Supervised" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Autonomous" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Only the owner can change this.")).toBeTruthy();
  });

  it("surfaces the server's FORBIDDEN message verbatim on a failed save", () => {
    getQuery.mockReturnValue(settingsResult("supervised"));
    meQuery.mockReturnValue(meResult("owner"));
    updateMutate.mockImplementation((_input: unknown, opts: { onError: (e: { message: string }) => void }) => {
      opts.onError({ message: "only the owner can change what the assistant may do on its own" });
    });
    render(<AutonomyRow />);
    open();

    fireEvent.click(screen.getByRole("button", { name: "Assisted" }));

    expect(screen.getByText("only the owner can change what the assistant may do on its own")).toBeTruthy();
  });
});
