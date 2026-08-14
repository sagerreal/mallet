// @vitest-environment jsdom
/**
 * The note add is OPTIMISTIC (the house store pattern): the input clears and the note shows in
 * the feed synchronously on submit — appendJobNote's own optimistic set is the feed's copy — and a
 * refused persist rolls back with a visible error, restoring the text so nothing typed is lost.
 *
 * The component sends the TEXT of one note, never a rebuilt blob. Assembling the whole notes field
 * in the browser is how two people adding a note in the same minute erased each other.
 * It used to clear only on the mutation's success, so for the whole round trip the same words
 * sat in the input AND the list.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NoteFeed } from "./note-feed";
import type { Job } from "@/lib/store/types";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    leadId: "lead-1",
    svc: "service",
    origin: "db",
    title: "Drain clear",
    addr: "",
    phone: "",
    status: "scheduled",
    archived: false,
    lines: [],
    addons: [],
    photos: [],
    notes: "",
    acts: [],
    visits: [],
    ...overrides,
  } as Job;
}

const input = () => screen.getByLabelText("Add a note") as HTMLInputElement;
const addButton = () => screen.getByRole("button", { name: "Add note" });

function mount(appendNote: (id: string, text: string) => Promise<{ ok: boolean }>) {
  render(<NoteFeed job={makeJob()} canCompose appendNote={appendNote} />);
  // The composer lives inside the collapsed section row — open it first.
  fireEvent.click(screen.getByText("Job notes"));
}

describe("NoteFeed — optimistic add", () => {
  it("clears the input SYNCHRONOUSLY on submit, before the persist settles", () => {
    // A promise that never settles inside this test — the clear must not wait for it.
    const appendNote = vi.fn(() => new Promise<{ ok: boolean }>(() => {}));
    mount(appendNote);

    fireEvent.change(input(), { target: { value: "Valve was corroded" } });
    fireEvent.click(addButton());

    expect(appendNote).toHaveBeenCalledWith("job-1", "Valve was corroded");
    // Synchronous — no await between the click and this read.
    expect(input().value).toBe("");
  });

  it("keeps the input clear and shows no error once the persist succeeds", async () => {
    const appendNote = vi.fn(() => Promise.resolve({ ok: true }));
    mount(appendNote);

    fireEvent.change(input(), { target: { value: "Flushed the line" } });
    fireEvent.click(addButton());

    await waitFor(() => expect(appendNote).toHaveBeenCalledOnce());
    expect(input().value).toBe("");
    expect(screen.queryByText(/couldn't save the note/i)).toBeNull();
  });

  it("a refused persist shows the error and RESTORES the text — nothing typed is lost", async () => {
    const appendNote = vi.fn(() => Promise.resolve({ ok: false }));
    mount(appendNote);

    fireEvent.change(input(), { target: { value: "Valve was corroded" } });
    fireEvent.click(addButton());

    await waitFor(() => expect(screen.getByText(/couldn't save the note/i)).toBeTruthy());
    expect(input().value).toBe("Valve was corroded");
  });

  it("never clobbers newer typing with the failed note's text", async () => {
    let reject!: (v: { ok: boolean }) => void;
    const appendNote = vi.fn(() => new Promise<{ ok: boolean }>((res) => { reject = res; }));
    mount(appendNote);

    fireEvent.change(input(), { target: { value: "First note" } });
    fireEvent.click(addButton());
    // The tech is already typing the next note when the first one is refused.
    fireEvent.change(input(), { target: { value: "Second note" } });
    reject({ ok: false });

    await waitFor(() => expect(screen.getByText(/couldn't save the note/i)).toBeTruthy());
    expect(input().value).toBe("Second note");
  });

  it("a second submit while empty does nothing (the cleared input is the double-tap guard)", () => {
    const appendNote = vi.fn(() => new Promise<{ ok: boolean }>(() => {}));
    mount(appendNote);

    fireEvent.change(input(), { target: { value: "One note" } });
    fireEvent.click(addButton());
    fireEvent.click(addButton());

    expect(appendNote).toHaveBeenCalledOnce();
  });
});

describe("NoteFeed — who may write", () => {
  it("gives a TECH the composer; the person at the job is the one with something to record", () => {
    // canCompose was `isOffice && !done`, so a tech opened this section to "No notes yet." and
    // nothing else — a control that could only be read. The field router already trusts a tech
    // with setVisitNotes; a job note is the same act at job scope.
    render(<NoteFeed job={makeJob()} canCompose appendNote={vi.fn()} />);
    fireEvent.click(screen.getByText("Job notes"));

    expect(screen.getByLabelText("Add a note")).toBeTruthy();
  });
});
