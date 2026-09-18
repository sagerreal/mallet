import { describe, it, expect } from "vitest";
import { dtoLeadNoteToStore, type LeadNoteDTO } from "./dto-mapper";

const base: LeadNoteDTO = {
  id: "note-1",
  leadId: "lead-1",
  kind: "note",
  body: "Panel is 200A",
  author: null,
  direction: null,
  outcome: null,
  durationLabel: null,
  via: null,
  overnight: false,
  createdAt: "2026-08-19T16:04:00.000Z",
  attachmentPath: null,
  attachmentType: null,
  attachmentName: null,
};

describe("dtoLeadNoteToStore — attachment", () => {
  it("collapses the three columns into att", () => {
    const note = dtoLeadNoteToStore({
      ...base,
      attachmentPath: "org-1/leads/lead-1/obj.jpg",
      attachmentType: "image/jpeg",
      attachmentName: "panel-label.jpg",
    });
    expect(note.att).toEqual({
      path: "org-1/leads/lead-1/obj.jpg",
      type: "image/jpeg",
      name: "panel-label.jpg",
    });
  });

  // Absent, not `att: undefined`: the feed tests presence, and every other optional field on
  // this mapper is spread in the same way.
  it("leaves att off a note with no attachment", () => {
    const note = dtoLeadNoteToStore(base);
    expect("att" in note).toBe(false);
  });

  // The row's CHECK keeps the trio together. If that ever slipped, a half-set row must render as
  // a plain note rather than a button labelled with nothing.
  it("ignores a partial trio rather than minting a nameless attachment", () => {
    const note = dtoLeadNoteToStore({ ...base, attachmentPath: "org-1/leads/lead-1/obj.jpg" });
    expect(note.att).toBeUndefined();
  });
});
