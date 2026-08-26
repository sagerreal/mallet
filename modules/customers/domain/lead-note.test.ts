import { describe, it, expect } from "vitest";
import { asOrgId, asLeadId } from "@mallet/shared/types";
import {
  LeadNote,
  LEAD_NOTE_MAX,
  LEAD_NOTE_ATTACHMENT_NAME_MAX,
  leadNoteAttachmentPrefix,
} from "./lead-note";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD = asLeadId("33333333-3333-3333-3333-333333333333");
const OTHER_LEAD = asLeadId("44444444-4444-4444-4444-444444444444");

const PATH = `${leadNoteAttachmentPrefix(ORG, LEAD)}55555555-5555-5555-5555-555555555555.jpg`;

const base = {
  id: "11111111-1111-1111-1111-111111111111",
  orgId: ORG,
  leadId: LEAD,
  kind: "note" as const,
  body: "Gate code 4412",
  author: "Dana",
  direction: null,
  outcome: null,
  durationLabel: null,
  via: null,
  overnight: false,
  createdAt: new Date("2026-08-19T00:00:00Z"),
};

const attachment = {
  attachmentPath: PATH,
  attachmentType: "image/jpeg",
  attachmentName: "panel-label.jpg",
};

describe("LeadNote", () => {
  it("creates a plain note and trims the body", () => {
    const r = LeadNote.create({ ...base, body: "  Gate code 4412  " });
    expect(r.ok && r.value.props.body).toBe("Gate code 4412");
    expect(r.ok && r.value.attachment).toBe(null);
  });

  it("leaves the attachment columns explicitly null when nothing is attached", () => {
    const r = LeadNote.create(base);
    if (!r.ok) throw new Error("seed failed");
    expect(r.value.props.attachmentPath).toBe(null);
    expect(r.value.props.attachmentType).toBe(null);
    expect(r.value.props.attachmentName).toBe(null);
  });

  it("allows an attachment with NO text — a photo of a panel label is a real note", () => {
    const r = LeadNote.create({ ...base, body: "   ", ...attachment });
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.props.body).toBe("");
    expect(r.ok && r.value.attachment).toEqual({
      path: PATH,
      type: "image/jpeg",
      name: "panel-label.jpg",
    });
  });

  it("carries text AND an attachment together", () => {
    const r = LeadNote.create({ ...base, ...attachment });
    expect(r.ok && r.value.props.body).toBe("Gate code 4412");
    expect(r.ok && r.value.props.attachmentName).toBe("panel-label.jpg");
  });

  it("refuses a note with neither text nor an attachment — that is a slip, not a record", () => {
    const r = LeadNote.create({ ...base, body: "   " });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.field).toBe("body");
  });

  it("still lets a call log an outcome with no typed body", () => {
    const r = LeadNote.create({
      ...base,
      kind: "call",
      body: "",
      outcome: "No answer",
    });
    expect(r.ok).toBe(true);
  });

  it.each([
    ["path only", { attachmentPath: PATH }],
    ["type only", { attachmentType: "image/jpeg" }],
    ["name only", { attachmentName: "panel-label.jpg" }],
    [
      "path and type, no name",
      { attachmentPath: PATH, attachmentType: "image/jpeg" },
    ],
    [
      "path and name, no type",
      { attachmentPath: PATH, attachmentName: "panel-label.jpg" },
    ],
    ["blank name beside a real path", { ...attachment, attachmentName: "   " }],
  ])("refuses a partial attachment shape — %s", (_label, partial) => {
    const r = LeadNote.create({ ...base, ...partial });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.field).toBe("attachment");
  });

  it("refuses a path under ANOTHER customer's folder", () => {
    const r = LeadNote.create({
      ...base,
      ...attachment,
      attachmentPath: `${leadNoteAttachmentPrefix(ORG, OTHER_LEAD)}55555555.jpg`,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.field).toBe("attachmentPath");
  });

  it("refuses a path under another ORG's folder", () => {
    const foreignOrg = asOrgId("99999999-9999-9999-9999-999999999999");
    const r = LeadNote.create({
      ...base,
      ...attachment,
      attachmentPath: `${leadNoteAttachmentPrefix(foreignOrg, LEAD)}55555555.jpg`,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.field).toBe("attachmentPath");
  });

  it.each([
    [
      "a job-photos key that skips the leads folder",
      `${ORG}/${LEAD}/55555555.jpg`,
    ],
    [
      "the folder itself, naming no object",
      leadNoteAttachmentPrefix(ORG, LEAD),
    ],
    [
      "a traversal",
      `${leadNoteAttachmentPrefix(ORG, LEAD)}../../other/55555555.jpg`,
    ],
    ["a bare filename", "55555555.jpg"],
  ])("refuses %s", (_label, path) => {
    const r = LeadNote.create({ ...base, ...attachment, attachmentPath: path });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.field).toBe("attachmentPath");
  });

  it("refuses a type that is not a mime", () => {
    const r = LeadNote.create({
      ...base,
      ...attachment,
      attachmentType: "jpeg",
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.field).toBe("attachmentType");
  });

  it("caps the file name", () => {
    const long = `${"x".repeat(LEAD_NOTE_ATTACHMENT_NAME_MAX)}.jpg`;
    const r = LeadNote.create({ ...base, ...attachment, attachmentName: long });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.field).toBe("attachmentName");
  });

  it("caps the body", () => {
    expect(
      LeadNote.create({ ...base, body: "x".repeat(LEAD_NOTE_MAX + 1) }).ok,
    ).toBe(false);
    expect(
      LeadNote.create({ ...base, body: "x".repeat(LEAD_NOTE_MAX) }).ok,
    ).toBe(true);
  });

  it("refuses an unknown kind", () => {
    const r = LeadNote.create({ ...base, kind: "memo" as never });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.field).toBe("kind");
  });

  it("does not mutate the props handed in", () => {
    const props = { ...base, body: "  spaced  " };
    LeadNote.create(props);
    expect(props.body).toBe("  spaced  ");
  });
});
