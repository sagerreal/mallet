// @vitest-environment jsdom
/**
 * NOTES, FILES AND THE CUSTOMER'S NOTES SHARE ONE CHAPTER. A file and the sentence explaining it
 * belong together; two rows put them a scroll apart. The chapter also has to appear for a job
 * carrying ONLY an attachment — it was gated on the note count, so a job with a permit and no note
 * showed nothing at all.
 *
 * The row is now the "Notes" chapter (SheetRow variant="section"), holding two flat groups:
 * "This job" (feed + composer + files) and, when the customer has notes on file, a read-only
 * "On the customer". What used to be a second "Customer notes" row is inside it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

interface Store {
  jobs: unknown[];
  leads: unknown[];
  invoices: unknown[];
  techs: unknown[];
  updateJob: () => void;
  updateLead: () => void;
  appendJobNote: (jobId: string, text: string) => Promise<{ ok: boolean }>;
  attachJobFile: () => void;
}
let store: Store;
const appendJobNoteMock = vi.fn(async () => ({ ok: true }));

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Store) => unknown) => sel(store),
  useActiveModal: () => ({ id: "JOB", params: { jobId: "job-1" } }),
  useCloseModal: () => vi.fn(),
  usePushModal: () => vi.fn(),
  useOpenModal: () => vi.fn(),
}));

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { jobs: { get: { invalidate: vi.fn() } }, invoicing: { list: { invalidate: vi.fn() } } } }),
    v1: {
      links: { forRecord: { useQuery: () => ({ data: undefined }) } },
      jobs: { get: { useQuery: () => ({ data: undefined, isLoading: false, isError: false }) } },
      invoicing: { createFromJob: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
      customers: { listNotes: { useQuery: () => ({ data: undefined, isFetched: true }) } },
    },
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { JobModalContent } from "./job-modal";

const FILE = {
  id: "f1",
  storagePath: "o/j/permit.pdf",
  name: "permit-2939.pdf",
  mimeType: "application/pdf",
  caption: null,
};

const seed = (
  jobPatch: Record<string, unknown> = {},
  leadPatch: Record<string, unknown> = {},
) => {
  store = {
    jobs: [{
      id: "job-1", leadId: "lead-1", title: "test job", cust: "Cole Hayes",
      status: "scheduled", kind: "work", svc: "service",
      lines: [], addons: [], visits: [], photos: [], notes: "", ...jobPatch,
    }],
    leads: [{ id: "lead-1", name: "Cole Hayes", stage: "Quoted", phone: "+14155550123", ...leadPatch }],
    invoices: [], techs: [], updateJob: vi.fn(), updateLead: vi.fn(),
    appendJobNote: appendJobNoteMock, attachJobFile: vi.fn(),
  };
};

/**
 * Render once, then read the CLOSED chapter head — what the office sees on arrival, without
 * opening anything. A helper that renders on every call double-mounts the sheet.
 */
const openSheet = () => {
  render(<JobModalContent />);
  return screen.queryByRole("button", { name: /^Notes/ });
};

describe("job sheet — notes, files and the customer's notes in one chapter", () => {
  beforeEach(() => { vi.clearAllMocks(); seed(); });

  // The bug this closes: gated on notes alone, a job carrying only a permit showed nothing.
  it("shows the chapter for a job with a file and NO notes", () => {
    seed({ files: [FILE], notes: "" });
    const r = openSheet();
    expect(r).not.toBeNull();
    expect(r!.textContent).toMatch(/1 file/);
  });

  it("counts notes and files together on the closed row", () => {
    seed({ files: [FILE, { ...FILE, id: "f2" }], notes: "[Aug 20] gate code 4482" });
    expect(openSheet()!.textContent).toMatch(/1 · 2 files/);
  });

  it("says just the note count when there are no files", () => {
    seed({ files: [], notes: "[Aug 20] gate code 4482" });
    const r = openSheet();
    expect(r!.textContent).toMatch(/1/);
    expect(r!.textContent).not.toMatch(/file/);
  });

  // There is no second row to find — that was the point of merging them.
  it("has no separate Files row", () => {
    seed({ files: [FILE] });
    openSheet();
    expect(screen.queryByRole("button", { name: /^Files/ })).toBeNull();
  });

  /**
   * IT USED TO STAY HIDDEN, and that was the bug. The only control that attaches a file to a job
   * lives inside this chapter, so gating it on already having content meant a job with nothing
   * on it could never receive its first note or its first permit — you had to get a note onto it
   * from the field just to make the row appear. It now behaves like the Contact chapter above it:
   * always present, "Add" when empty.
   */
  it("the office can write a job note — the feed used to be read-only here", async () => {
    const { userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    seed({ files: [], notes: "" });
    render(<JobModalContent />);
    await user.click(screen.getByRole("button", { name: /^Notes/ }));
    await user.type(screen.getByLabelText("Add a note"), "Gate code 4482");
    await user.click(screen.getByRole("button", { name: "Add note" }));
    expect(appendJobNoteMock).toHaveBeenCalledWith("job-1", "Gate code 4482");
  });

  it("refuses a note on a finished job, with the reason the server would give", async () => {
    const { userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    seed({ status: "done" });
    render(<JobModalContent />);
    await user.click(screen.getByRole("button", { name: /^Notes/ }));
    expect(screen.queryByLabelText("Add a note")).toBeNull();
    expect(screen.getByText(/complete — its notes are closed/)).toBeTruthy();
  });

  it("is offered on an empty job, so the first note and the first file have a way in", () => {
    seed({ files: [], notes: "" });
    const r = openSheet();
    expect(r).not.toBeNull();
    expect(r!.textContent).toMatch(/Add/);
  });

  /**
   * THE MERGE, from the office's side. "Customer notes" was its own row; folding it in must not
   * cost the reader the sentence it carried. A job with nothing on it, hanging off a customer
   * whose file says "Gate code 4482", must say so on the CLOSED line — "Add" over a customer with
   * notes on file would be a lie about what is inside.
   */
  it("borrows the customer's latest note for the closed line when the job has none", () => {
    seed({ files: [], notes: "" }, { notes: "Gate code 4482" });
    const r = openSheet();
    expect(r!.textContent).toMatch(/Gate code 4482/);
  });

  /**
   * The job's own count still leads: this sheet is about the job, and the customer's sentence is
   * only a stand-in for an empty one.
   */
  it("prefers the job's own count over the customer's note", () => {
    seed({ files: [], notes: "[Aug 20] shutoff is behind the fridge" }, { notes: "Gate code 4482" });
    const r = openSheet();
    expect(r!.textContent).toMatch(/1/);
    expect(r!.textContent).not.toMatch(/Gate code 4482/);
  });

  /**
   * Inside, the customer's notes read but do not write: one record, one edit path, and that path
   * is the customer link in the header. Two composers in one chapter would let the office file a
   * gate code against whichever record it happened to tab into.
   */
  it("shows the customer's notes inside, read-only under their own heading", async () => {
    const { userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    seed({ files: [], notes: "" }, { notes: "Gate code 4482" });
    render(<JobModalContent />);
    await user.click(screen.getByRole("button", { name: /^Notes/ }));

    const custGroup = screen.getByRole("group", { name: "On the customer" });
    expect(custGroup.textContent).toMatch(/Gate code 4482/);
    // One composer in the whole chapter, and it belongs to "This job".
    expect(screen.getAllByLabelText("Add a note")).toHaveLength(1);
    expect(within(custGroup).queryByLabelText("Add a note")).toBeNull();
    expect(
      within(screen.getByRole("group", { name: "This job" })).getByLabelText("Add a note"),
    ).toBeTruthy();
  });

  // Same point from the other side: the row it replaced must not still be sitting there.
  it("has no separate Customer notes row", () => {
    seed({ files: [], notes: "" }, { notes: "Gate code 4482" });
    openSheet();
    expect(screen.queryByRole("button", { name: /^Customer notes/ })).toBeNull();
  });

  /**
   * The chapter arrives CLOSED. It is the longest thing on the sheet — feed, composer and files —
   * and a sheet that opens with it expanded buries Price, Schedule and Checklist below the fold.
   */
  it("arrives collapsed, with the composer behind the chapter head", () => {
    seed({ files: [FILE], notes: "[Aug 20] gate code 4482" });
    const head = openSheet();
    expect(head!.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Add a note")).toBeNull();
  });
});
