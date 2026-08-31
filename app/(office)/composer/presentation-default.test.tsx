// @vitest-environment jsdom
/**
 * app/(office)/composer/presentation-default.test.tsx
 *
 * The Presentation tab's DEFAULT state — the mock's model, verbatim: "Every quote goes out as
 * a document. The choice is how much of one." No template gate, no blank page: the tab opens
 * on the toolbar and the rendered simple document, teaching copy standing in for what is not
 * yet filled in.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PresentationTab } from "./presentation-tab";
import { INITIAL_STATE, type ComposerState } from "./composer-state";
import { defaultPresentation } from "./presentation-state";

const listQuery = vi.fn(() => ({ data: [], isPending: false, isError: false }));
vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { settings: { presentationTemplates: { list: { invalidate: vi.fn() } } } } }),
    v1: {
      settings: {
        businessIdentity: { useQuery: () => ({ data: { name: "E2E Plumbing", address: "4418 Elm St", phone: "262.555.0114" } }) },
        presentationTemplates: {
          list: { useQuery: () => listQuery() },
          create: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
          update: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
        },
      },
      quoting: { proposalPhotoUrls: { useQuery: () => ({ data: undefined }) } },
    },
  },
}));

const onUpdate = vi.fn();
beforeEach(() => {
  onUpdate.mockClear();
  cleanup();
});

const draw = (patch: Partial<ComposerState> = {}, leadName: string | null = null) =>
  render(
    <PresentationTab
      state={{ ...INITIAL_STATE, ...patch }}
      onUpdate={onUpdate}
      leadName={leadName}
      leadJob={null}
      onGoToEstimate={vi.fn()}
    />,
  );

describe("the default document", () => {
  it("renders the toolbar and the simple document with NO template picked — never a blank page", () => {
    draw();
    expect(screen.getByRole("toolbar", { name: "Document formatting" })).toBeTruthy();
    expect(screen.getByText(/Proposal · E2E Plumbing/)).toBeTruthy();
    expect(screen.getByText("Your estimate")).toBeTruthy();
    expect(screen.getByText("Terms & conditions")).toBeTruthy();
    expect(screen.getByText("Page 1 of 1")).toBeTruthy();
    expect(screen.queryByText("No presentation")).toBeNull();
  });

  it("teaches what is missing, in the document's own voice", () => {
    draw();
    expect(screen.getByText(/Add a customer on the Estimate tab/)).toBeTruthy();
    expect(screen.getByText(/No line items yet — build the estimate on the Estimate tab/)).toBeTruthy();
    expect(screen.getByText(/No terms yet — pick them in the Terms panel/)).toBeTruthy();
  });

  it("puts the customer and the terms on the page once they exist", () => {
    draw({ terms: { id: "t1", text: "Payment due on completion." } }, "Dana Whitfield");
    expect(screen.getByText("Dana Whitfield")).toBeTruthy();
    expect(screen.getByText("Payment due on completion.")).toBeTruthy();
    expect(screen.queryByText(/No terms yet/)).toBeNull();
  });

  it("carries the company bar with the accept affordance above the sheet", () => {
    draw();
    expect(screen.getByRole("button", { name: "Accept estimate" })).toBeTruthy();
  });

  it("leads the cover with the masthead title", () => {
    draw({ title: "Backyard fence replacement — 124 Alder Ct" });
    expect(screen.getByRole("heading", { level: 2, name: "Backyard fence replacement — 124 Alder Ct" })).toBeTruthy();
  });
});

describe("full proposal", () => {
  it("puts the cover sheet in front and the warranty stays beside the terms", () => {
    const p = defaultPresentation();
    draw({
      presentation: {
        ...p,
        mode: "full",
        pages: p.pages.map((page) =>
          page.key === "warranty" ? { ...page, body: "Two years on workmanship." } : page,
        ),
      },
    });
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
    const estimateSheet = screen.getByRole("article", { name: "The estimate" });
    expect(estimateSheet.textContent).toContain("Two years on workmanship.");
  });
});

describe("editing the unlinked default", () => {
  it("saves the edit onto THIS quote — no template, no server write", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: "EDIT COVER ›" }));
    fireEvent.change(screen.getByLabelText(/What this covers/), {
      target: { value: "Cedar privacy fence — supply & install" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const patch = onUpdate.mock.calls.at(-1)![0];
    expect(patch.presentation.templateId).toBeNull();
    expect(patch.presentation.pages.find((x: { key: string }) => x.key === "cover").title).toBe(
      "Cedar privacy fence — supply & install",
    );
  });
});
