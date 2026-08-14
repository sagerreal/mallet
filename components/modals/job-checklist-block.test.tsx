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

/**
 * Enter steps into the editor the panel now shares with the Checklists library. Keeps taking a
 * newline-joined string so the existing cases read unchanged; blank lines still mean "a row that
 * was added and left empty", which the panel drops.
 */
function paste(lines: string) {
  const rows = lines.split("\n");
  rows.forEach((text, i) => {
    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    fireEvent.change(screen.getByLabelText(`Step ${i + 1} description`), { target: { value: text } });
  });
}

// ---------------------------------------------------------------------------
// Quick create — paste lines, Add to job
// ---------------------------------------------------------------------------

describe("JobChecklistBlock — Add to job", () => {
  it("turns steps into items (required, blank rows dropped) in ONE create, then attaches", async () => {
    openPanel();
    paste("Photo of the install\n\n  Test T&P valve  \nHaul away old unit\n");
    fireEvent.click(screen.getByRole("button", { name: "Add to job" }));

    await waitFor(() => expect(h.state.updateJob).toHaveBeenCalledOnce());
    expect(h.state.addChecklist).toHaveBeenCalledOnce();
    const [name, stage, items] = h.state.addChecklist.mock.calls[0] as [string, string, NewItem[]];
    expect(name).toBe("Checklist"); // default when the name input is empty
    expect(stage).toBe("job");
    // Every step is a Check unless the author says otherwise. The old textarea GUESSED at the
    // type from the words ("photo" in the text made it a photo step), which is the guesswork the
    // Check/Photo toggle replaced — see the photo-step test below.
    expect(items).toEqual([
      { text: "Photo of the install", type: "check", required: true },
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
    fireEvent.change(screen.getByLabelText("Checklist name"), { target: { value: "Repipe close-out" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to job" }));
    await waitFor(() => expect(h.state.addChecklist).toHaveBeenCalledOnce());
    expect(h.state.addChecklist.mock.calls[0]![0]).toBe("Repipe close-out");
  });

  it("no steps → functional error, nothing created", () => {
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Add to job" }));
    expect(screen.getByText("Add at least one step.")).toBeTruthy();
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

describe("JobChecklistBlock — the two ways \"Couldn't save the checklist\" happened", () => {
  it("names the over-long line instead of sending it and reporting 'try again'", async () => {
    // The server caps an item at 500 characters. With no client guard the whole checklist was
    // rejected with a raw 400 and the office was told only to try again — the one thing that
    // could never work.
    openPanel();
    paste(`ok line\n${"x".repeat(520)}`);
    fireEvent.click(screen.getByText("Add to job"));

    await waitFor(() => expect(screen.getByText(/Step 2 is 20 characters too long/)).toBeTruthy());
    expect(h.state.addChecklist).not.toHaveBeenCalled();
    expect(h.state.updateJob).not.toHaveBeenCalled();
  });

  it("offers no way in on a finished job, instead of a control that can only fail", () => {
    // Every checklist write 400s on a completed job ("cannot edit a completed or canceled job").
    // The opener used to be offered anyway: it saved a template, failed the attach, wiped the
    // typed text, and left one orphan template behind per retry.
    render(<JobChecklistBlock job={makeJob({ status: "complete" })} />);

    expect(screen.queryByText("+ Add a checklist")).toBeNull();
    expect(screen.getByText(/reopen it to add one/)).toBeTruthy();
  });

  it("hides Remove on a finished job that already has a checklist", () => {
    const job = makeJob({
      status: "complete",
      checklist: { name: "Close out", items: [{ id: "i1", text: "Photo of the panel", type: "photo", required: true, position: 0 }] },
    });
    render(<JobChecklistBlock job={job} />);

    // The list still READS — it just can't be written to any more.
    expect(screen.getByText("Photo of the panel")).toBeTruthy();
    expect(screen.queryByText("Remove")).toBeNull();
  });
});

describe("JobChecklistBlock — one kind of checklist", () => {
  it("offers a checklist left on the retired scope stage", async () => {
    // The panel filtered to stage === "job", so a scoping list could be created but never attached
    // from the job sheet — the only way onto a job was at creation time. With the stages collapsed
    // there is one pool, and a shop's existing scope lists must not stay stranded.
    h.state.checklists = [makeSaved({ id: "chk-legacy", name: "Repipe walkthrough", stage: "scope" })];
    openPanel();

    expect(screen.getByText("Repipe walkthrough")).toBeTruthy();
  });

  it("attaches it to the job when tapped", async () => {
    h.state.checklists = [makeSaved({ id: "chk-legacy", name: "Repipe walkthrough", stage: "scope" })];
    openPanel();

    fireEvent.click(screen.getByText("Repipe walkthrough"));

    await waitFor(() =>
      expect(h.state.updateJob).toHaveBeenCalledWith(
        "job-111",
        expect.objectContaining({ checklist: expect.objectContaining({ name: "Repipe walkthrough" }) }),
      ),
    );
  });
});

describe("JobChecklistBlock — the same editor the Checklists library uses", () => {
  it("builds a checklist from real steps, not a textarea of lines", async () => {
    // "One item per line" could not express a photo step at all — the only way to get one was a
    // /photo|picture/i guess at the words — and it made every line required with no way to say
    // otherwise. The library had a proper editor; the surface the crew actually runs the list from
    // had the worse one.
    openPanel();

    expect(screen.queryByPlaceholderText("One item per line")).toBeNull();
    fireEvent.change(screen.getByLabelText("Checklist name"), { target: { value: "Drain cleaning" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    fireEvent.change(screen.getByLabelText("Step 1 description"), { target: { value: "Water back on" } });
    fireEvent.click(screen.getByText("Add to job"));

    await waitFor(() => expect(h.state.addChecklist).toHaveBeenCalled());
    const [name, stage, items] = h.state.addChecklist.mock.calls[0]!;
    expect(name).toBe("Drain cleaning");
    expect(stage).toBe("job");
    expect(items).toEqual([{ text: "Water back on", type: "check", required: true }]);
  });

  it("saves a photo step as a photo step", async () => {
    openPanel();
    fireEvent.change(screen.getByLabelText("Checklist name"), { target: { value: "Close-out" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    fireEvent.change(screen.getByLabelText("Step 1 description"), { target: { value: "Under the sink" } });
    fireEvent.click(screen.getByRole("button", { name: "Photo" }));
    fireEvent.click(screen.getByText("Add to job"));

    await waitFor(() => expect(h.state.addChecklist).toHaveBeenCalled());
    expect(h.state.addChecklist.mock.calls[0]![2]).toEqual([
      { text: "Under the sink", type: "photo", required: true },
    ]);
  });

  it("drops a blank step rather than saving an empty line", async () => {
    openPanel();
    fireEvent.change(screen.getByLabelText("Checklist name"), { target: { value: "Close-out" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    fireEvent.change(screen.getByLabelText("Step 1 description"), { target: { value: "Real step" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    fireEvent.click(screen.getByText("Add to job"));

    await waitFor(() => expect(h.state.addChecklist).toHaveBeenCalled());
    expect(h.state.addChecklist.mock.calls[0]![2]).toHaveLength(1);
  });

  it("says so when there is nothing to add", async () => {
    openPanel();
    fireEvent.change(screen.getByLabelText("Checklist name"), { target: { value: "Empty" } });
    fireEvent.click(screen.getByText("Add to job"));

    await waitFor(() => expect(screen.getByText(/Add at least one step/)).toBeTruthy());
    expect(h.state.addChecklist).not.toHaveBeenCalled();
  });
});
