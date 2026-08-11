// @vitest-environment jsdom
/**
 * The note add is OPTIMISTIC (the house store pattern): the input clears and the note shows in
 * the feed synchronously on submit — updateJob's own optimistic set is the feed's copy — and a
 * refused persist rolls back with a visible error, restoring the text so nothing typed is lost.
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

function mount(updateJob: (id: string, patch: Partial<Job>) => Promise<{ ok: boolean }>) {
  render(<NoteFeed job={makeJob()} canCompose updateJob={updateJob} />);
  // The composer lives inside the collapsed section row — open it first.
  fireEvent.click(screen.getByText("Job notes"));
}

describe("NoteFeed — optimistic add", () => {
  it("clears the input SYNCHRONOUSLY on submit, before the persist settles", () => {
    // A promise that never settles inside this test — the clear must not wait for it.
    const updateJob = vi.fn(() => new Promise<{ ok: boolean }>(() => {}));
    mount(updateJob);

    fireEvent.change(input(), { target: { value: "Valve was corroded" } });
    fireEvent.click(addButton());

    expect(updateJob).toHaveBeenCalledWith("job-1", {
      notes: expect.stringContaining("Valve was corroded"),
    });
    // Synchronous — no await between the click and this read.
    expect(input().value).toBe("");
  });

  it("keeps the input clear and shows no error once the persist succeeds", async () => {
    const updateJob = vi.fn(() => Promise.resolve({ ok: true }));
    mount(updateJob);

    fireEvent.change(input(), { target: { value: "Flushed the line" } });
    fireEvent.click(addButton());

    await waitFor(() => expect(updateJob).toHaveBeenCalledOnce());
    expect(input().value).toBe("");
    expect(screen.queryByText(/couldn't save the note/i)).toBeNull();
  });

  it("a refused persist shows the error and RESTORES the text — nothing typed is lost", async () => {
    const updateJob = vi.fn(() => Promise.resolve({ ok: false }));
    mount(updateJob);

    fireEvent.change(input(), { target: { value: "Valve was corroded" } });
    fireEvent.click(addButton());

    await waitFor(() => expect(screen.getByText(/couldn't save the note/i)).toBeTruthy());
    expect(input().value).toBe("Valve was corroded");
  });

  it("never clobbers newer typing with the failed note's text", async () => {
    let reject!: (v: { ok: boolean }) => void;
    const updateJob = vi.fn(() => new Promise<{ ok: boolean }>((res) => { reject = res; }));
    mount(updateJob);

    fireEvent.change(input(), { target: { value: "First note" } });
    fireEvent.click(addButton());
    // The tech is already typing the next note when the first one is refused.
    fireEvent.change(input(), { target: { value: "Second note" } });
    reject({ ok: false });

    await waitFor(() => expect(screen.getByText(/couldn't save the note/i)).toBeTruthy());
    expect(input().value).toBe("Second note");
  });

  it("a second submit while empty does nothing (the cleared input is the double-tap guard)", () => {
    const updateJob = vi.fn(() => new Promise<{ ok: boolean }>(() => {}));
    mount(updateJob);

    fireEvent.change(input(), { target: { value: "One note" } });
    fireEvent.click(addButton());
    fireEvent.click(addButton());

    expect(updateJob).toHaveBeenCalledOnce();
  });
});
