// @vitest-environment jsdom
/**
 * Settings → Workspace → "Documents" — the wording slots on customer documents.
 *
 * What must hold:
 *   - one quiet row per slot; the collapsed value says whether the shop's own wording stands;
 *   - a row expands IN-FLOW to a textarea seeded with the CURRENT EFFECTIVE sentence;
 *   - Save sends ONLY that slot; text identical to the standard (or blank) saves as null,
 *     so the standard wording is never frozen into an override;
 *   - "Reset to standard" exists only where an override stands, and clears it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { DocumentsCard } from "./documents-card";

const mutate = vi.fn();
const invalidate = vi.fn();

interface SettingsData {
  brand: { name: string };
  documents: {
    invoiceFooter: string | null;
    payInstructions: string | null;
    receiptNote: string | null;
    changeOrderAgreement: string | null;
  };
}

let queryState: { data: SettingsData | undefined; isFetched: boolean } = {
  data: undefined,
  isFetched: false,
};
let isPending = false;

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      v1: {
        settings: {
          get: { invalidate },
          documentWording: { invalidate },
        },
      },
    }),
    v1: {
      settings: {
        get: { useQuery: () => queryState },
        updateDocuments: { useMutation: () => ({ mutate, isPending }) },
      },
    },
  },
}));

vi.mock("./fold-card", () => ({
  FoldCard: ({ title, summary, children }: { title: string; summary?: string; children: React.ReactNode }) => (
    <div data-testid="foldcard">
      <div className="fhead">
        <h3>{title}</h3>
        {summary && <span className="fsum">{summary}</span>}
      </div>
      <div className="fbody">{children}</div>
    </div>
  ),
}));

const loaded = (over: Partial<SettingsData["documents"]> = {}): void => {
  queryState = {
    isFetched: true,
    data: {
      brand: { name: "Rivera Plumbing" },
      documents: {
        invoiceFooter: null,
        payInstructions: null,
        receiptNote: null,
        changeOrderAgreement: null,
        ...over,
      },
    },
  };
};

const openRow = (label: string): void => {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(label) }));
};

describe("DocumentsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPending = false;
    queryState = { data: undefined, isFetched: false };
  });

  it("waits for the real values before showing rows", () => {
    render(<DocumentsCard />);
    expect(screen.getByText("Loading…", { selector: "p" })).toBeTruthy();
    expect(screen.queryByText("Invoice footer")).toBeNull();
  });

  it("shows one quiet row per slot, in plain trade vocabulary", () => {
    loaded();
    render(<DocumentsCard />);
    expect(screen.getByText("Invoice footer")).toBeTruthy();
    expect(screen.getByText("Payment instructions")).toBeTruthy();
    expect(screen.getByText("Receipt note")).toBeTruthy();
    expect(screen.getByText("Change-order agreement line")).toBeTruthy();
  });

  it("collapsed values say what stands: Standard for the sentences, None for the footer", () => {
    // The footer has no standard sentence — an untouched shop prints nothing there, and a row
    // reading "Standard" would imply a footer exists.
    loaded();
    render(<DocumentsCard />);
    expect(screen.getByText("None", { selector: ".fdd-v" })).toBeTruthy();
    expect(screen.getAllByText("Standard", { selector: ".fdd-v" })).toHaveLength(3);
  });

  it("collapsed value shows the shop's own wording once set", () => {
    loaded({ payInstructions: "Zelle to (925) 555-0100." });
    render(<DocumentsCard />);
    expect(screen.getByText("Zelle to (925) 555-0100.", { selector: ".fdd-v" })).toBeTruthy();
  });

  it("expanding a row seeds the textarea with the CURRENT EFFECTIVE sentence", () => {
    loaded();
    render(<DocumentsCard />);
    openRow("Payment instructions");
    expect(
      screen.getByDisplayValue("To pay this invoice, contact Rivera Plumbing directly."),
    ).toBeTruthy();
  });

  it("expanding the footer row seeds an EMPTY textarea — there is no standard footer", () => {
    loaded();
    render(<DocumentsCard />);
    openRow("Invoice footer");
    const box = screen.getByLabelText("Invoice footer", { selector: "textarea" }) as HTMLTextAreaElement;
    expect(box.value).toBe("");
  });

  it("saves ONLY the edited slot", () => {
    loaded();
    render(<DocumentsCard />);
    openRow("Receipt note");
    fireEvent.change(screen.getByLabelText("Receipt note", { selector: "textarea" }), {
      target: { value: "Paid in full — thank you!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toEqual({ receiptNote: "Paid in full — thank you!" });
  });

  it("saving text identical to the standard stores NULL — the standard is never frozen", () => {
    // A shop that opens the row and hits Save unchanged must stay on the standard wording, so
    // a future improvement to the standard sentence reaches them.
    loaded();
    render(<DocumentsCard />);
    openRow("Payment instructions");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mutate.mock.calls[0]?.[0]).toEqual({ payInstructions: null });
  });

  it("saving blank stores NULL, never a stored space", () => {
    loaded({ receiptNote: "Old note." });
    render(<DocumentsCard />);
    openRow("Receipt note");
    fireEvent.change(screen.getByLabelText("Receipt note", { selector: "textarea" }), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mutate.mock.calls[0]?.[0]).toEqual({ receiptNote: null });
  });

  it("the change-order row seeds the standard sentence and saving EITHER variant stores null", () => {
    loaded();
    render(<DocumentsCard />);
    openRow("Change-order agreement line");
    const box = screen.getByLabelText("Change-order agreement line", {
      selector: "textarea",
    }) as HTMLTextAreaElement;
    expect(box.value).toBe(
      "The customer approves adding the work listed above, at the price shown, to this job with Rivera Plumbing. It bills with the job.",
    );
    // Retyping the SIGNED-job variant is still the standard wording, not an override.
    fireEvent.change(box, {
      target: {
        value:
          "The customer approves adding the work listed above, at the price shown, to the job they already signed with Rivera Plumbing. It bills with the job.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mutate.mock.calls[0]?.[0]).toEqual({ changeOrderAgreement: null });
  });

  it("offers Reset to standard only where an override stands, and it clears the slot", () => {
    loaded({ invoiceFooter: "1-year warranty on labor." });
    render(<DocumentsCard />);

    openRow("Receipt note");
    expect(screen.queryByRole("button", { name: "Reset to standard" })).toBeNull();

    openRow("Invoice footer");
    fireEvent.click(screen.getByRole("button", { name: "Reset to standard" }));
    expect(mutate.mock.calls[0]?.[0]).toEqual({ invoiceFooter: null });
  });

  it("surfaces a save failure instead of failing silently", () => {
    loaded();
    render(<DocumentsCard />);
    openRow("Invoice footer");
    fireEvent.change(screen.getByLabelText("Invoice footer", { selector: "textarea" }), {
      target: { value: "Thanks!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const onError = mutate.mock.calls[0]?.[1]?.onError as (e: unknown) => void;
    act(() => {
      onError({ message: "boom", data: {} });
    });
    expect(screen.getByRole("alert").textContent).toContain("Couldn't save the wording");
  });

  it("flashes Saved and refreshes both reads after a successful save", () => {
    loaded();
    render(<DocumentsCard />);
    openRow("Invoice footer");
    fireEvent.change(screen.getByLabelText("Invoice footer", { selector: "textarea" }), {
      target: { value: "Thanks!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const onSuccess = mutate.mock.calls[0]?.[1]?.onSuccess as () => void;
    act(() => {
      onSuccess();
    });
    // Both the office settings payload AND the anyRole wording read (the close-out and the CO
    // sign screen hydrate from it) must refetch, or the field surfaces keep stale sentences.
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Saved ✓")).toBeTruthy();
  });

  it("disables Save while the write is in flight", () => {
    loaded();
    isPending = true;
    render(<DocumentsCard />);
    openRow("Invoice footer");
    expect(screen.getByRole("button", { name: /saving/i }).hasAttribute("disabled")).toBe(true);
  });
});
