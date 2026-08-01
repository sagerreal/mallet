import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Customer notes have to reach the database.
 *
 * THE BUG Owen reported: type a gate code into a customer's Notes composer, come back, gone.
 *
 * `addLeadNote` wrote to `lead.acts` in the Zustand store and stopped there. The store has no
 * persist middleware, and the leads hydrator sets `acts: []` on every refetch — so the note did
 * not even survive until a reload, only until the next background refetch.
 *
 * The blast radius was wider than the typed note: logged call outcomes, sent texts and Front Desk
 * entries all append through this same action, so the ENTIRE customer activity trail was
 * ephemeral. That is why this persists rather than special-casing the composer.
 */

// vi.mock is hoisted above these declarations, so the factory must not close over a local —
// vi.hoisted lifts the spies with it.
const { addNote, removeNote } = vi.hoisted(() => ({ addNote: vi.fn(), removeNote: vi.fn() }));
vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: { v1: { customers: { addNote: { mutate: addNote }, removeNote: { mutate: removeNote } } } },
}));
vi.mock("@/lib/trpc/list-cache", () => ({ invalidateLists: vi.fn() }));

import { useAppStore } from "@/lib/store/app-store";
import type { Lead } from "@/lib/store/types";

const LEAD_ID = "11111111-1111-4111-8111-111111111111";

const lead = (over: Partial<Lead> = {}): Lead =>
  ({ id: LEAD_ID, name: "Jill Vance", phone: "", stage: "", age: 0, job: "", last: "",
     source: "", acts: [], archived: false, ...over }) as Lead;

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("addLeadNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addNote.mockResolvedValue({});
    removeNote.mockResolvedValue({ removed: true });
    useAppStore.setState({ leads: [lead()] });
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows the note immediately — the composer must not wait on a round-trip", () => {
    useAppStore.getState().addLeadNote(LEAD_ID, { type: "note", when: "Just now", notes: "Gate code 4482" });
    expect(useAppStore.getState().leads[0]!.acts).toHaveLength(1);
  });

  it("PERSISTS it — the whole point", async () => {
    useAppStore.getState().addLeadNote(LEAD_ID, { type: "note", when: "Just now", notes: "Gate code 4482" });
    await flush();
    expect(addNote).toHaveBeenCalledTimes(1);
    expect(addNote.mock.calls[0]![0]).toMatchObject({ leadId: LEAD_ID, kind: "note", body: "Gate code 4482" });
  });

  // The home queue's 30s Undo deletes exactly the note a Send appended, so the caller needs the
  // id before the server has replied. A server-assigned id could not be handed back in time.
  it("returns a UUID id synchronously, and sends that same id", async () => {
    const note = useAppStore.getState().addLeadNote(LEAD_ID, { type: "text", from: "us", when: "Just now", t: "On our way" });
    expect(note.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    await flush();
    expect(addNote.mock.calls[0]![0].id).toBe(note.id);
  });

  it("carries the call's shape — a logged call is more than its text", async () => {
    useAppStore.getState().addLeadNote(LEAD_ID, {
      type: "call", dir: "out", outcome: "No answer", dur: "0:12", via: "mobile", when: "Just now", t: "",
    });
    await flush();
    expect(addNote.mock.calls[0]![0]).toMatchObject({
      kind: "call", direction: "out", outcome: "No answer", durationLabel: "0:12", via: "mobile",
    });
  });

  it("rolls the note back out of the feed when the write fails", async () => {
    addNote.mockRejectedValue(new Error("offline"));
    useAppStore.getState().addLeadNote(LEAD_ID, { type: "note", when: "Just now", notes: "Gate code 4482" });
    await flush();
    expect(useAppStore.getState().leads[0]!.acts).toHaveLength(0);
  });

  // A note on a customer outside the loaded page would otherwise write to nothing and still POST.
  it("does not persist a note for a customer the store does not hold", async () => {
    useAppStore.setState({ leads: [] });
    useAppStore.getState().addLeadNote(LEAD_ID, { type: "note", when: "Just now", notes: "orphan" });
    await flush();
    expect(addNote).not.toHaveBeenCalled();
  });
});

describe("removeLeadNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addNote.mockResolvedValue({});
    removeNote.mockResolvedValue({ removed: true });
    useAppStore.setState({ leads: [lead()] });
  });

  it("deletes it server-side too — otherwise Undo is undone by the next refetch", async () => {
    const note = useAppStore.getState().addLeadNote(LEAD_ID, { type: "text", from: "us", when: "Just now", t: "On our way" });
    await flush();
    useAppStore.getState().removeLeadNote(LEAD_ID, note.id!);
    await flush();
    expect(removeNote).toHaveBeenCalledWith({ noteId: note.id });
    expect(useAppStore.getState().leads[0]!.acts).toHaveLength(0);
  });

  // Purely local entries (seeded or legacy, non-UUID ids) have no row to delete.
  it("does not call the server for a note that was never persisted", async () => {
    useAppStore.setState({ leads: [lead({ acts: [{ id: "legacy-1", type: "note", when: "", notes: "x" }] })] });
    useAppStore.getState().removeLeadNote(LEAD_ID, "legacy-1");
    await flush();
    expect(removeNote).not.toHaveBeenCalled();
  });
});
