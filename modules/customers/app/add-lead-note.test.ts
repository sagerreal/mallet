import { describe, it, expect, vi } from "vitest";
import { AddLeadNoteUseCase } from "./add-lead-note";
import { RemoveLeadNoteUseCase } from "./remove-lead-note";
import { ListLeadNotesUseCase } from "./list-lead-notes";
import { LeadNote } from "../domain/lead-note";
import type { LeadNoteRepository } from "../domain/lead-note-repository";
import type { LeadRepository } from "../domain/lead-repository";
import { asLeadId, asOrgId } from "@mallet/shared/types";

/**
 * Writing to the customer's activity trail.
 *
 * The trail used to exist only in the browser's Zustand store, which has no persist middleware
 * and whose leads hydrator resets `acts: []` on every refetch. A gate code typed into a customer's
 * Notes composer survived until the next background refetch and then vanished — along with every
 * logged call outcome and sent text, which append through the same path.
 */

const ORG = asOrgId("22222222-2222-4222-8222-222222222222");
const LEAD = asLeadId("11111111-1111-4111-8111-111111111111");
const NOW = new Date("2026-08-01T12:00:00Z");

const input = (over: Record<string, unknown> = {}) => ({
  id: "33333333-3333-4333-8333-333333333333",
  orgId: ORG,
  leadId: LEAD,
  kind: "note" as const,
  body: "Gate code 4482",
  author: null,
  direction: null,
  outcome: null,
  durationLabel: null,
  via: null,
  overnight: false,
  now: NOW,
  ...over,
});

const notesRepo = (over: Partial<LeadNoteRepository> = {}): LeadNoteRepository => ({
  add: vi.fn(async (n: LeadNote) => n),
  listByLead: vi.fn(async () => []),
  remove: vi.fn(async () => true),
  ...over,
});

const leadsRepo = (found = true) =>
  ({ findById: vi.fn(async () => (found ? ({} as never) : null)) }) as unknown as LeadRepository;

describe("AddLeadNoteUseCase", () => {
  it("saves the note", async () => {
    const notes = notesRepo();
    const r = await new AddLeadNoteUseCase(notes, leadsRepo()).exec(input());
    expect(r.ok).toBe(true);
    expect(notes.add).toHaveBeenCalledTimes(1);
  });

  it("keeps the client-authored id — the Undo needs to delete this exact row", async () => {
    const notes = notesRepo();
    const r = await new AddLeadNoteUseCase(notes, leadsRepo()).exec(input());
    expect(r.ok && r.value.props.id).toBe("33333333-3333-4333-8333-333333333333");
  });

  it("trims the body", async () => {
    const r = await new AddLeadNoteUseCase(notesRepo(), leadsRepo()).exec(input({ body: "  Gate code 4482  " }));
    expect(r.ok && r.value.props.body).toBe("Gate code 4482");
  });

  it("carries a call's shape — a logged call is more than its text", async () => {
    const r = await new AddLeadNoteUseCase(notesRepo(), leadsRepo()).exec(
      input({ kind: "call", body: "", direction: "out", outcome: "No answer", durationLabel: "0:12", via: "mobile" }),
    );
    expect(r.ok && r.value.props).toMatchObject({
      direction: "out", outcome: "No answer", durationLabel: "0:12", via: "mobile",
    });
  });

  // A call or a system entry legitimately has no typed body ("No answer" IS the record).
  it("allows an empty body on a call but not on a typed note", async () => {
    const call = await new AddLeadNoteUseCase(notesRepo(), leadsRepo()).exec(input({ kind: "call", body: "" }));
    expect(call.ok).toBe(true);
    const note = await new AddLeadNoteUseCase(notesRepo(), leadsRepo()).exec(input({ body: "   " }));
    expect(note.ok).toBe(false);
  });

  // The trail is a customer's record, not a chat: a photo of a panel label IS the note, and the
  // use-case must not require a sentence beside it. The domain enforces the rule; this asserts
  // the attachment actually reaches it rather than being dropped in the carry.
  it("carries an attachment through to the note", async () => {
    const notes = notesRepo();
    const r = await new AddLeadNoteUseCase(notes, leadsRepo()).exec(
      input({
        body: "",
        attachment: { path: `${ORG}/leads/${LEAD}/aa.jpg`, type: "image/jpeg", name: "panel-label.jpg" },
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.attachment).toEqual({
      path: `${ORG}/leads/${LEAD}/aa.jpg`,
      type: "image/jpeg",
      name: "panel-label.jpg",
    });
  });

  // Three explicit nulls, never three absent keys — the columns are read as a set at rest.
  it("writes no attachment when none was given", async () => {
    const r = await new AddLeadNoteUseCase(notesRepo(), leadsRepo()).exec(input());
    expect(r.ok && r.value.props.attachmentPath).toBeNull();
    expect(r.ok && r.value.attachment).toBeNull();
  });

  // A path under another customer's folder is a cross-tenant reach dressed as a filename.
  it("refuses a path outside this customer's own folder", async () => {
    const notes = notesRepo();
    const r = await new AddLeadNoteUseCase(notes, leadsRepo()).exec(
      input({
        attachment: {
          path: `${ORG}/leads/99999999-9999-4999-8999-999999999999/aa.jpg`,
          type: "image/jpeg",
          name: "aa.jpg",
        },
      }),
    );
    expect(r.ok).toBe(false);
    expect(notes.add).not.toHaveBeenCalled();
  });

  it("refuses a body past the column's ceiling instead of letting the database truncate it", async () => {
    const r = await new AddLeadNoteUseCase(notesRepo(), leadsRepo()).exec(input({ body: "x".repeat(2001) }));
    expect(r.ok).toBe(false);
  });

  // The composite FK would reject this anyway, but as a bare constraint violation that reaches
  // the user as "check your connection".
  it("names a missing customer rather than letting the FK raise", async () => {
    const notes = notesRepo();
    const r = await new AddLeadNoteUseCase(notes, leadsRepo(false)).exec(input());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe("not_found");
    expect(notes.add).not.toHaveBeenCalled();
  });
});

describe("RemoveLeadNoteUseCase", () => {
  it("soft-deletes the note", async () => {
    const notes = notesRepo();
    const r = await new RemoveLeadNoteUseCase(notes).exec("33333333-3333-4333-8333-333333333333");
    expect(r.ok).toBe(true);
    expect(notes.remove).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333");
  });

  // The repository filters by org, so "no row" also covers another tenant's id. The caller
  // learns nothing either way, which is the point.
  it("reports not-found for an id that matches nothing in this org", async () => {
    const r = await new RemoveLeadNoteUseCase(notesRepo({ remove: vi.fn(async () => false) })).exec(
      "44444444-4444-4444-8444-444444444444",
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe("not_found");
  });
});

describe("ListLeadNotesUseCase", () => {
  it("returns the customer's trail", async () => {
    const notes = notesRepo();
    await new ListLeadNotesUseCase(notes).exec(LEAD);
    expect(notes.listByLead).toHaveBeenCalledWith(LEAD);
  });
});
