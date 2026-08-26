// @vitest-environment jsdom
/**
 * NOTES AND FILES SHARE ONE ROW. A file and the sentence explaining it belong together; two rows
 * put them a scroll apart. The row also has to appear for a job carrying ONLY an attachment — it
 * was gated on the note count, so a job with a permit and no note showed nothing at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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

const seed = (jobPatch: Record<string, unknown> = {}) => {
  store = {
    jobs: [{
      id: "job-1", leadId: "lead-1", title: "test job", cust: "Cole Hayes",
      status: "scheduled", kind: "work", svc: "service",
      lines: [], addons: [], visits: [], photos: [], notes: "", ...jobPatch,
    }],
    leads: [{ id: "lead-1", name: "Cole Hayes", stage: "Quoted", phone: "+14155550123" }],
    invoices: [], techs: [], updateJob: vi.fn(), updateLead: vi.fn(),
    appendJobNote: appendJobNoteMock, attachJobFile: vi.fn(),
  };
};

/** Render once, then read. A helper that renders on every call double-mounts the sheet. */
const openSheet = () => {
  render(<JobModalContent />);
  return screen.queryByRole("button", { name: /^Job notes/ });
};

describe("job sheet — notes and files in one row", () => {
  beforeEach(() => { vi.clearAllMocks(); seed(); });

  // The bug this closes: gated on notes alone, a job carrying only a permit showed nothing.
  it("shows the row for a job with a file and NO notes", () => {
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
   * lives inside this row, so gating the row on already having content meant a job with nothing
   * on it could never receive its first note or its first permit — you had to get a note onto it
   * from the field just to make the row appear. It now behaves like Phone, Email and Service
   * address above it: always present, "Add" when empty.
   */
  it("the office can write a job note — the feed used to be read-only here", async () => {
    const { userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    seed({ files: [], notes: "" });
    render(<JobModalContent />);
    await user.click(screen.getByRole("button", { name: /^Job notes/ }));
    await user.type(screen.getByLabelText("Add a note"), "Gate code 4482");
    await user.click(screen.getByRole("button", { name: "Add note" }));
    expect(appendJobNoteMock).toHaveBeenCalledWith("job-1", "Gate code 4482");
  });

  it("refuses a note on a finished job, with the reason the server would give", async () => {
    const { userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    seed({ status: "done" });
    render(<JobModalContent />);
    await user.click(screen.getByRole("button", { name: /^Job notes/ }));
    expect(screen.queryByLabelText("Add a note")).toBeNull();
    expect(screen.getByText(/complete — its notes are closed/)).toBeTruthy();
  });

  it("is offered on an empty job, so the first note and the first file have a way in", () => {
    seed({ files: [], notes: "" });
    const r = openSheet();
    expect(r).not.toBeNull();
    expect(r!.textContent).toMatch(/Add/);
  });
});
