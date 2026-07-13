// @vitest-environment jsdom
/**
 * components/modals/job-checklist-block.test.tsx
 *
 * Guards the ONE-panel checklist flow:
 *   - entry point → panel (saved rows + textarea + "Add to job")
 *   - "Add to job" turns textarea lines into items (photo heuristic, required,
 *     empties dropped), saves them in ONE addChecklist call, attaches via
 *     updateJob(job.id, { checklist })
 *   - saved row tap attaches; row ✕ deletes via deleteChecklist
 *   - empty state offers the one-tap plumbing starter checklists
 *   - persist failures surface inline (create / attach / remove) — no silent
 *     revert; a retry after a failed attach doesn't duplicate the checklist
 *   - the item cap (50) is enforced with functional copy
 *   - no "template" concept anywhere in the copy
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Checklist, Job } from "@/lib/store/types";

// ---------------------------------------------------------------------------
// Store mock — the block reads checklists + actions via useAppStore, and the
// retry path re-reads through useAppStore.getState().
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  interface MockState {
    checklists: Checklist[];
    updateJob: ReturnType<typeof vi.fn>;
    addChecklist: ReturnType<typeof vi.fn>;
    deleteChecklist: ReturnType<typeof vi.fn>;
  }
  const state: MockState = {
    checklists: [],
    updateJob: vi.fn(),
    addChecklist: vi.fn(),
    deleteChecklist: vi.fn(),
  };
  return { state };
});

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: Object.assign(
    (selector: (s: typeof h.state) => unknown) => selector(h.state),
    { getState: () => h.state },
  ),
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

function makeSaved(overrides: Partial<Checklist> = {}): Checklist {
  return {
    id: "chk-1",
    name: "Water heater close-out",
    trade: "Custom",
    stage: "job",
    match: [],
    items: [
      { id: "i1", text: "Photo of the T&P valve", type: "photo", required: true, position: 0 },
      { id: "i2", text: "Test hot water at a tap", type: "check", required: true, position: 1 },
    ],
    ...overrides,
  };
}

type NewItem = { text: string; type: "check" | "photo"; required?: boolean };

beforeEach(() => {
  h.state.checklists = [];
  // Mirrors the slice: updateJob resolves { ok } and never rejects.
  h.state.updateJob = vi.fn(() => Promise.resolve({ ok: true }));
  h.state.deleteChecklist = vi.fn();
  // Default addChecklist mimics the slice: appends the new checklist (items
  // included, client ids minted) and resolves `persisted` with it.
  h.state.addChecklist = vi.fn(
    (name: string, stage: Checklist["stage"], items: readonly NewItem[] = []) => {
      const checklist: Checklist = {
        id: `chk-new-${h.state.addChecklist.mock.calls.length}`,
        name,
        trade: "Custom",
        stage,
        match: [],
        items: items.map((it, i) => ({
          id: `item-${i}`,
          text: it.text,
          type: it.type,
          required: it.required ?? false,
          position: i,
        })),
      };
      h.state.checklists = [...h.state.checklists, checklist];
      return { checklist, persisted: Promise.resolve(checklist) };
    },
  );
});

function openPanel(job = makeJob()) {
  render(<JobChecklistBlock job={job} />);
  fireEvent.click(screen.getByText("+ Add a checklist"));
}

function paste(lines: string) {
  fireEvent.change(screen.getByPlaceholderText("One item per line"), {
    target: { value: lines },
  });
}

// ---------------------------------------------------------------------------
// Quick create — paste lines, Add to job
// ---------------------------------------------------------------------------

describe("JobChecklistBlock — Add to job", () => {
  it("turns lines into items (photo heuristic, required, empties dropped) in ONE create, then attaches", async () => {
    openPanel();
    paste("Photo of the install\n\n  Test T&P valve  \nHaul away old unit\n");
    fireEvent.click(screen.getByRole("button", { name: "Add to job" }));

    await waitFor(() => expect(h.state.updateJob).toHaveBeenCalledOnce());
    expect(h.state.addChecklist).toHaveBeenCalledOnce();
    const [name, stage, items] = h.state.addChecklist.mock.calls[0] as [string, string, NewItem[]];
    expect(name).toBe("Checklist"); // default when the name input is empty
    expect(stage).toBe("job");
    expect(items).toEqual([
      { text: "Photo of the install", type: "photo", required: true },
      { text: "Test T&P valve", type: "check", required: true },
      { text: "Haul away old unit", type: "check", required: true },
    ]);
    // The attach carries the persisted checklist snapshot.
    const [jobId, patch] = h.state.updateJob.mock.calls[0] as [
      string,
      { checklist: { name: string; items: unknown[] } },
    ];
    expect(jobId).toBe("job-111");
    expect(patch.checklist.name).toBe("Checklist");
    expect(patch.checklist.items).toHaveLength(3);
  });

  it("uses the typed name when given", async () => {
    openPanel();
    paste("One thing");
    fireEvent.change(screen.getByPlaceholderText("Checklist"), {
      target: { value: "Repipe close-out" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to job" }));
    await waitFor(() => expect(h.state.addChecklist).toHaveBeenCalledOnce());
    expect(h.state.addChecklist.mock.calls[0]![0]).toBe("Repipe close-out");
  });

  it("empty textarea → functional error, nothing created", () => {
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Add to job" }));
    expect(screen.getByText("Add at least one item — one per line.")).toBeTruthy();
    expect(h.state.addChecklist).not.toHaveBeenCalled();
    expect(h.state.updateJob).not.toHaveBeenCalled();
  });

  it("caps at 50 items with functional copy", () => {
    openPanel();
    paste(Array.from({ length: 52 }, (_, i) => `Item ${i + 1}`).join("\n"));
    fireEvent.click(screen.getByRole("button", { name: "Add to job" }));
    expect(screen.getByText(/at most 50 items — remove 2/)).toBeTruthy();
    expect(h.state.addChecklist).not.toHaveBeenCalled();
  });

  it("create failure surfaces inline; updateJob is not called", async () => {
    h.state.addChecklist = vi.fn(() => ({
      checklist: makeSaved(),
      persisted: Promise.reject(new Error("network")),
    }));
    openPanel();
    paste("One thing");
    fireEvent.click(screen.getByRole("button", { name: "Add to job" }));
    await waitFor(() =>
      expect(screen.getByText("Couldn't save the checklist — try again.")).toBeTruthy(),
    );
    expect(h.state.updateJob).not.toHaveBeenCalled();
  });

  it("a retry after a failed ATTACH reuses the created checklist (no duplicate)", async () => {
    h.state.updateJob = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    openPanel();
    paste("One thing");
    fireEvent.click(screen.getByRole("button", { name: "Add to job" }));
    await waitFor(() =>
      expect(screen.getByText("Couldn't save the checklist — try again.")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add to job" }));
    await waitFor(() => expect(h.state.updateJob).toHaveBeenCalledTimes(2));
    expect(h.state.addChecklist).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Saved rows
// ---------------------------------------------------------------------------

describe("JobChecklistBlock — saved checklists", () => {
  it("renders rows as name + item count and attaches on tap (no create)", async () => {
    h.state.checklists = [makeSaved()];
    openPanel();
    expect(screen.getByText("2 items")).toBeTruthy();
    fireEvent.click(screen.getByText("Water heater close-out"));
    await waitFor(() => expect(h.state.updateJob).toHaveBeenCalledOnce());
    const [, patch] = h.state.updateJob.mock.calls[0] as [
      string,
      { checklist: { name: string; items: unknown[] } },
    ];
    expect(patch.checklist.name).toBe("Water heater close-out");
    expect(patch.checklist.items).toHaveLength(2);
    expect(h.state.addChecklist).not.toHaveBeenCalled();
  });

  it("✕ deletes the saved checklist", () => {
    h.state.checklists = [makeSaved()];
    openPanel();
    fireEvent.click(screen.getByTitle("Delete this checklist"));
    expect(h.state.deleteChecklist).toHaveBeenCalledWith("chk-1");
    expect(h.state.updateJob).not.toHaveBeenCalled();
  });

  it("a saved list over the job cap is refused with functional copy", () => {
    const big = makeSaved({
      items: Array.from({ length: 51 }, (_, i) => ({
        id: `i${i}`,
        text: `Item ${i}`,
        type: "check" as const,
        required: false,
        position: i,
      })),
    });
    h.state.checklists = [big];
    openPanel();
    fireEvent.click(screen.getByText("Water heater close-out"));
    expect(screen.getByText(/has 51 items — a job holds at most 50/)).toBeTruthy();
    expect(h.state.updateJob).not.toHaveBeenCalled();
  });

  it("attach failure keeps the panel open with inline copy", async () => {
    h.state.checklists = [makeSaved()];
    h.state.updateJob = vi.fn(() => Promise.resolve({ ok: false }));
    openPanel();
    fireEvent.click(screen.getByText("Water heater close-out"));
    await waitFor(() =>
      expect(screen.getByText("Couldn't save the checklist — try again.")).toBeTruthy(),
    );
  });

  it("empty state offers the plumbing starters; one tap creates them all (saved, required items)", async () => {
    openPanel();
    fireEvent.click(screen.getByText("Start with plumbing basics"));
    await waitFor(() => expect(h.state.addChecklist).toHaveBeenCalledTimes(3));
    for (const call of h.state.addChecklist.mock.calls as [string, string, NewItem[]][]) {
      expect(call[1]).toBe("job");
      expect(call[2].length).toBeGreaterThan(0);
      expect(call[2].every((it) => it.required)).toBe(true);
    }
    // Not attached to the job — they land as reusable rows.
    expect(h.state.updateJob).not.toHaveBeenCalled();
  });

  it("the panel never says 'template'", () => {
    h.state.checklists = [makeSaved()];
    const { container } = render(<JobChecklistBlock job={makeJob()} />);
    fireEvent.click(screen.getByText("+ Add a checklist"));
    expect(container.textContent).not.toMatch(/template/i);
  });
});

// ---------------------------------------------------------------------------
// Attached view
// ---------------------------------------------------------------------------

describe("JobChecklistBlock — attached view", () => {
  const attachedJob = makeJob({
    checklist: {
      name: "Water heater close-out",
      items: [
        { id: "i1", text: "Photo of the T&P valve", type: "photo", required: true, position: 0 },
      ],
    },
  });

  it("renders the attached checklist and detaches via checklist: undefined", async () => {
    render(<JobChecklistBlock job={attachedJob} />);
    expect(screen.getByText("Before you leave")).toBeTruthy();
    expect(screen.getByText("Photo of the T&P valve")).toBeTruthy();
    fireEvent.click(screen.getByText("Remove"));
    await waitFor(() => expect(h.state.updateJob).toHaveBeenCalledOnce());
    expect(h.state.updateJob).toHaveBeenCalledWith("job-111", { checklist: undefined });
  });

  it("a failed remove surfaces inline instead of silently reverting", async () => {
    h.state.updateJob = vi.fn(() => Promise.resolve({ ok: false }));
    render(<JobChecklistBlock job={attachedJob} />);
    fireEvent.click(screen.getByText("Remove"));
    await waitFor(() =>
      expect(screen.getByText("Couldn't save the checklist — try again.")).toBeTruthy(),
    );
  });
});
