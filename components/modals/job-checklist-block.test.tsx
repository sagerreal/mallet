// @vitest-environment jsdom
/**
 * components/modals/job-checklist-block.test.tsx
 *
 * Guards the checklist attach flow:
 *   - entry point → picker; zero-template orgs land straight on the create form
 *   - create-form validation ("Name the checklist.")
 *   - Create & attach authors the template (addChecklist/addChecklistItem with the
 *     photo heuristic) and attaches via updateJob(job.id, { checklist })
 *   - template row attach calls updateJob with the template's name + items
 *   - "Manage templates" opens MODAL.STANDARDS
 *   - attached view renders items; Remove detaches via checklist: undefined
 *   - persist failures surface inline (attach / create-and-attach / remove) —
 *     no silent revert; a retry after a failed attach doesn't duplicate the template
 *   - a template over the job item cap (50) is refused with functional copy
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MODAL } from "@/lib/store/modal-ids";
import type { Checklist, Job } from "@/lib/store/types";

// ---------------------------------------------------------------------------
// Store mock — the block reads checklists + actions via useAppStore, and reads
// the authored items back through useAppStore.getState().
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  interface MockState {
    checklists: Checklist[];
    updateJob: ReturnType<typeof vi.fn>;
    addChecklist: ReturnType<typeof vi.fn>;
    addChecklistItem: ReturnType<typeof vi.fn>;
  }
  const state: MockState = {
    checklists: [],
    updateJob: vi.fn(),
    addChecklist: vi.fn(),
    addChecklistItem: vi.fn(),
  };
  const openModal = vi.fn();
  return { state, openModal };
});

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: Object.assign(
    (selector: (s: typeof h.state) => unknown) => selector(h.state),
    { getState: () => h.state },
  ),
  useOpenModal: () => h.openModal,
}));

import { JobChecklistBlock } from "./job-checklist-block";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-111",
    leadId: "lead-aaa",
    svc: "service",
    origin: "db",
    title: "Fix boiler",
    addr: "",
    phone: "",
    status: "unscheduled",
    archived: false,
    lines: [],
    addons: [],
    photos: [],
    notes: "",
    acts: [],
    visits: [],
    ...overrides,
  };
}

function makeTemplate(overrides: Partial<Checklist> = {}): Checklist {
  return {
    id: "tpl-1",
    name: "Water heater swap",
    trade: "Custom",
    stage: "job",
    match: [],
    items: [
      { id: "i1", text: "Photo of the T&P valve", type: "photo", required: true, position: 0 },
      { id: "i2", text: "Test hot water at a tap", type: "check", required: false, position: 1 },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  h.state.checklists = [];
  // Mirrors the slice: updateJob resolves { ok } and never rejects.
  h.state.updateJob = vi.fn(() => Promise.resolve({ ok: true }));
  h.state.addChecklistItem = vi.fn();
  h.openModal.mockReset();
  // Default addChecklist mimics the slice: appends the new template to the store
  // (so getState() finds it) and returns { checklist, persisted }.
  h.state.addChecklist = vi.fn((name: string, stage: Checklist["stage"]) => {
    const checklist: Checklist = { id: "chk-new", name, trade: "Custom", stage, match: [], items: [] };
    h.state.checklists = [...h.state.checklists, checklist];
    return { checklist, persisted: Promise.resolve() };
  });
  // Default addChecklistItem mimics the slice: appends the item immutably.
  h.state.addChecklistItem = vi.fn((checklistId: string, text: string, type: "check" | "photo" = "check") => {
    h.state.checklists = h.state.checklists.map((c) =>
      c.id === checklistId
        ? {
            ...c,
            items: [
              ...c.items,
              { id: `item-${c.items.length}`, text, type, required: false, position: c.items.length },
            ],
          }
        : c,
    );
  });
});

// ---------------------------------------------------------------------------
// Entry point → picker
// ---------------------------------------------------------------------------

describe("JobChecklistBlock — entry + picker", () => {
  it("renders the entry point and opens the picker on click", () => {
    render(<JobChecklistBlock job={makeJob()} />);
    fireEvent.click(screen.getByText("+ Add a checklist"));
    expect(screen.getByText("Attach a checklist")).toBeTruthy();
  });

  it("with zero templates, shows the create form immediately (no dead end)", () => {
    render(<JobChecklistBlock job={makeJob()} />);
    fireEvent.click(screen.getByText("+ Add a checklist"));
    expect(screen.getByText("No templates yet — create one below.")).toBeTruthy();
    expect(screen.getByPlaceholderText(/Name — e.g./)).toBeTruthy();
    expect(screen.getByText("Create & attach")).toBeTruthy();
  });

  it("'Manage templates' opens the standards modal", () => {
    render(<JobChecklistBlock job={makeJob()} />);
    fireEvent.click(screen.getByText("+ Add a checklist"));
    fireEvent.click(screen.getByText("Manage templates"));
    expect(h.openModal).toHaveBeenCalledWith(MODAL.STANDARDS);
  });

  it("attaches an existing template through updateJob", async () => {
    const tpl = makeTemplate();
    h.state.checklists = [tpl];
    render(<JobChecklistBlock job={makeJob()} />);
    fireEvent.click(screen.getByText("+ Add a checklist"));
    fireEvent.click(screen.getByText("Water heater swap"));
    expect(h.state.updateJob).toHaveBeenCalledWith("job-111", {
      checklist: { name: tpl.name, items: tpl.items },
    });
    await act(async () => {}); // flush the awaited { ok: true } continuation
  });

  it("ignores scope-stage templates (job stage only)", () => {
    h.state.checklists = [makeTemplate({ stage: "scope", name: "Scope walk" })];
    render(<JobChecklistBlock job={makeJob()} />);
    fireEvent.click(screen.getByText("+ Add a checklist"));
    expect(screen.queryByText("Scope walk")).toBeNull();
    expect(screen.getByText("No templates yet — create one below.")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Create form
// ---------------------------------------------------------------------------

describe("JobChecklistBlock — create form", () => {
  function openForm() {
    render(<JobChecklistBlock job={makeJob()} />);
    fireEvent.click(screen.getByText("+ Add a checklist"));
  }

  it("rejects an empty name with 'Name the checklist.' and creates nothing", () => {
    openForm();
    fireEvent.click(screen.getByText("Create & attach"));
    expect(screen.getByText("Name the checklist.")).toBeTruthy();
    expect(h.state.addChecklist).not.toHaveBeenCalled();
    expect(h.state.updateJob).not.toHaveBeenCalled();
  });

  it("creates the template, types items via the photo heuristic, and attaches", async () => {
    openForm();
    fireEvent.change(screen.getByPlaceholderText(/Name — e.g./), {
      target: { value: "Repipe close-out" },
    });
    const itemInput = screen.getByPlaceholderText(/Add an item/);
    fireEvent.change(itemInput, { target: { value: "Photo of the manifold" } });
    fireEvent.keyDown(itemInput, { key: "Enter" });
    fireEvent.change(itemInput, { target: { value: "Test water pressure" } });
    fireEvent.click(screen.getByText("Add"));
    fireEvent.click(screen.getByText("Create & attach"));

    expect(h.state.addChecklist).toHaveBeenCalledWith("Repipe close-out", "job");
    expect(h.state.addChecklistItem).toHaveBeenNthCalledWith(1, "chk-new", "Photo of the manifold", "photo");
    expect(h.state.addChecklistItem).toHaveBeenNthCalledWith(2, "chk-new", "Test water pressure", "check");
    expect(h.state.updateJob).toHaveBeenCalledWith("job-111", {
      checklist: {
        name: "Repipe close-out",
        items: [
          { id: "item-0", text: "Photo of the manifold", type: "photo", required: false, position: 0 },
          { id: "item-1", text: "Test water pressure", type: "check", required: false, position: 1 },
        ],
      },
    });
    await act(async () => {}); // flush the awaited { ok: true } continuation
  });

  it("folds a typed-but-not-added item row into the attach", async () => {
    openForm();
    fireEvent.change(screen.getByPlaceholderText(/Name — e.g./), {
      target: { value: "Quick check" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Add an item/), {
      target: { value: "Sweep the work area" },
    });
    fireEvent.click(screen.getByText("Create & attach"));
    expect(h.state.addChecklistItem).toHaveBeenCalledWith("chk-new", "Sweep the work area", "check");
    await act(async () => {}); // flush the awaited { ok: true } continuation
  });
});

// ---------------------------------------------------------------------------
// Persist failure surfacing — no silent revert on any of the three writes
// ---------------------------------------------------------------------------

const SAVE_FAILED = "Couldn't save the checklist — try again.";

describe("JobChecklistBlock — persist failure surfacing", () => {
  it("template attach failure keeps the picker open with inline copy", async () => {
    h.state.updateJob = vi.fn(() => Promise.resolve({ ok: false }));
    h.state.checklists = [makeTemplate()];
    render(<JobChecklistBlock job={makeJob()} />);
    fireEvent.click(screen.getByText("+ Add a checklist"));
    fireEvent.click(screen.getByText("Water heater swap"));
    expect(await screen.findByText(SAVE_FAILED)).toBeTruthy();
    // Still on the picker — the office can retry.
    expect(screen.getByText("Attach a checklist")).toBeTruthy();
  });

  it("create-and-attach failure keeps the form and its authored items with inline copy", async () => {
    h.state.updateJob = vi.fn(() => Promise.resolve({ ok: false }));
    render(<JobChecklistBlock job={makeJob()} />);
    fireEvent.click(screen.getByText("+ Add a checklist"));
    fireEvent.change(screen.getByPlaceholderText(/Name — e.g./), {
      target: { value: "Close-out" },
    });
    const itemInput = screen.getByPlaceholderText(/Add an item/);
    fireEvent.change(itemInput, { target: { value: "Sweep up" } });
    fireEvent.keyDown(itemInput, { key: "Enter" });
    fireEvent.click(screen.getByText("Create & attach"));
    expect(await screen.findByText(SAVE_FAILED)).toBeTruthy();
    // The typed content is NOT lost — the form stays open for a retry.
    expect(screen.getByText("Sweep up")).toBeTruthy();
    expect((screen.getByPlaceholderText(/Name — e.g./) as HTMLInputElement).value).toBe("Close-out");
  });

  it("a retry after a failed attach does not mint a duplicate template", async () => {
    const updateJob = vi
      .fn()
      .mockResolvedValueOnce({ ok: false }) // first attach fails
      .mockResolvedValue({ ok: true }); // retry succeeds
    h.state.updateJob = updateJob;
    render(<JobChecklistBlock job={makeJob()} />);
    fireEvent.click(screen.getByText("+ Add a checklist"));
    fireEvent.change(screen.getByPlaceholderText(/Name — e.g./), {
      target: { value: "Close-out" },
    });
    const itemInput = screen.getByPlaceholderText(/Add an item/);
    fireEvent.change(itemInput, { target: { value: "Sweep up" } });
    fireEvent.keyDown(itemInput, { key: "Enter" });
    fireEvent.click(screen.getByText("Create & attach"));
    await screen.findByText(SAVE_FAILED);

    fireEvent.click(screen.getByText("Create & attach"));
    await waitFor(() => expect(updateJob).toHaveBeenCalledTimes(2));
    // The template (and its items) were authored exactly once.
    expect(h.state.addChecklist).toHaveBeenCalledTimes(1);
    await act(async () => {});
  });

  it("remove failure keeps the attached view and shows inline copy", async () => {
    h.state.updateJob = vi.fn(() => Promise.resolve({ ok: false }));
    const attached = {
      name: "Water heater swap",
      items: [
        { id: "i1", text: "Photo of the T&P valve", type: "photo" as const, required: true, position: 0 },
      ],
    };
    render(<JobChecklistBlock job={makeJob({ checklist: attached })} />);
    fireEvent.click(screen.getByText("Remove"));
    expect(await screen.findByText(SAVE_FAILED)).toBeTruthy();
    expect(screen.getByText("Before you leave")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Job bounds guard — a template the job cannot hold is refused up front
// ---------------------------------------------------------------------------

describe("JobChecklistBlock — job bounds guard", () => {
  it("refuses a template with more than 50 items instead of calling updateJob", () => {
    const big = makeTemplate({
      id: "tpl-big",
      name: "Mega list",
      items: Array.from({ length: 51 }, (_, i) => ({
        id: `i${i}`,
        text: `Step ${i + 1}`,
        type: "check" as const,
        required: false,
        position: i,
      })),
    });
    h.state.checklists = [big];
    render(<JobChecklistBlock job={makeJob()} />);
    fireEvent.click(screen.getByText("+ Add a checklist"));
    fireEvent.click(screen.getByText("Mega list"));
    expect(
      screen.getByText(/51 items — a job checklist holds at most 50/),
    ).toBeTruthy();
    expect(h.state.updateJob).not.toHaveBeenCalled();
  });

  it("rejects a 51st item in the create form instead of calling updateJob", async () => {
    render(<JobChecklistBlock job={makeJob()} />);
    fireEvent.click(screen.getByText("+ Add a checklist"));
    fireEvent.change(screen.getByPlaceholderText(/Name — e.g./), {
      target: { value: "Mega list" },
    });
    const itemInput = screen.getByPlaceholderText(/Add an item/);
    for (let i = 0; i < 51; i++) {
      fireEvent.change(itemInput, { target: { value: `Step ${i + 1}` } });
      fireEvent.keyDown(itemInput, { key: "Enter" });
    }
    fireEvent.click(screen.getByText("Create & attach"));
    expect(await screen.findByText(/at most 50 items/)).toBeTruthy();
    expect(h.state.addChecklist).not.toHaveBeenCalled();
    expect(h.state.updateJob).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Attached view
// ---------------------------------------------------------------------------

describe("JobChecklistBlock — attached view", () => {
  const attached = {
    name: "Water heater swap",
    items: [
      { id: "i1", text: "Photo of the T&P valve", type: "photo" as const, required: true, position: 0 },
      { id: "i2", text: "Test hot water at a tap", type: "check" as const, required: false, position: 1 },
    ],
  };

  it("renders the checklist name and items with the required tag", () => {
    render(<JobChecklistBlock job={makeJob({ checklist: attached })} />);
    expect(screen.getByText("Before you leave")).toBeTruthy();
    expect(screen.getByText("Water heater swap")).toBeTruthy();
    expect(screen.getByText("Photo of the T&P valve")).toBeTruthy();
    expect(screen.getByText("required")).toBeTruthy();
  });

  it("Remove detaches via updateJob(job.id, { checklist: undefined })", () => {
    render(<JobChecklistBlock job={makeJob({ checklist: attached })} />);
    fireEvent.click(screen.getByText("Remove"));
    expect(h.state.updateJob).toHaveBeenCalledWith("job-111", { checklist: undefined });
  });
});
