// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const viewUrl = vi.fn();
vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: { v1: { customers: { noteViewUrl: { mutate: (a: unknown) => viewUrl(a) } } } },
}));

import { NoteRow, gatherNotes } from "./note-row";
import type { LeadNote } from "@/lib/store/types";

const att = { path: "org-1/leads/lead-1/obj.jpg", type: "image/jpeg", name: "panel-label.jpg" };
const lead = (acts: LeadNote[]) => ({ id: "lead-1", name: "Silva", acts });

describe("gatherNotes", () => {
  // The job modal renders THIS feed and knows nothing about attachments. If the attachment is
  // dropped here it is dropped on the job too, silently — the exact shape of mapper bug that
  // only a rendered surface catches.
  it("carries the attachment through to the entry", () => {
    const entries = gatherNotes(lead([{ id: "note-1", type: "note", when: "9:04", t: "Panel is 200A", att }]));
    expect(entries[0]?.attachment).toEqual({
      leadId: "lead-1",
      noteId: "note-1",
      name: "panel-label.jpg",
      type: "image/jpeg",
    });
  });

  it("leaves a wordless attachment note openable with no text", () => {
    const entries = gatherNotes(lead([{ id: "note-1", type: "note", when: "9:04", att }]));
    expect(entries[0]?.text).toBe("");
    expect(entries[0]?.attachment?.name).toBe("panel-label.jpg");
  });

  // The signed URL is minted by (org, lead, note id). A note still in flight has no row to look
  // up, so offering a button that cannot resolve would be a dead control.
  it("omits the attachment while the note has no server id", () => {
    const entries = gatherNotes(lead([{ type: "note", when: "Just now", t: "Panel is 200A", att }]));
    expect(entries[0]?.attachment).toBeUndefined();
  });

  it("leaves an ordinary note without one", () => {
    const entries = gatherNotes(lead([{ id: "note-1", type: "note", when: "9:04", t: "Gate code 4482" }]));
    expect(entries[0]?.attachment).toBeUndefined();
  });
});

describe("NoteRow attachment", () => {
  it("renders nothing extra for a note with no attachment", () => {
    render(<NoteRow entry={{ key: "k", type: "note", who: "Office", when: "9:04", text: "Gate code 4482" }} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("opens a tab BEFORE the round trip, then points it at the signed URL", async () => {
    const tab = { location: { href: "" }, close: vi.fn() };
    const open = vi.fn(() => tab);
    vi.stubGlobal("open", open);
    viewUrl.mockResolvedValue({ url: "https://signed.example/panel-label.jpg" });

    render(
      <NoteRow
        entry={{
          key: "k",
          type: "note",
          who: "Office",
          when: "9:04",
          text: "Panel is 200A",
          attachment: { leadId: "lead-1", noteId: "note-1", name: "panel-label.jpg", type: "image/jpeg" },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "panel-label.jpg" }));

    // The window exists before anything is awaited — a popup blocker refuses one opened after.
    expect(open).toHaveBeenCalled();
    await waitFor(() => expect(tab.location.href).toBe("https://signed.example/panel-label.jpg"));
    expect(viewUrl).toHaveBeenCalledWith({ leadId: "lead-1", id: "note-1" });
    vi.unstubAllGlobals();
  });

  it("closes the blank tab and says so when the link cannot be minted", async () => {
    const tab = { location: { href: "" }, close: vi.fn() };
    vi.stubGlobal("open", vi.fn(() => tab));
    viewUrl.mockRejectedValue(new Error("gone"));

    render(
      <NoteRow
        entry={{
          key: "k",
          type: "note",
          who: "Office",
          when: "9:04",
          text: "",
          attachment: { leadId: "lead-1", noteId: "note-1", name: "panel-label.jpg", type: "image/jpeg" },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "panel-label.jpg" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("That file wouldn't open — try again."));
    expect(tab.close).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
