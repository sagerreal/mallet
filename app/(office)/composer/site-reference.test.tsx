// @vitest-environment jsdom
/**
 * FROM THE SITE — the composer's reference card for the tech→office estimating lane.
 * The handoff signal existed (scope notes → "Needs quote" card); the destination was blind —
 * the office quoted a job whose notes, photos and checklist answers were three modals away.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SiteReference } from "./site-reference";
import type { Job } from "@/lib/store/types";

let mockJobs: Job[] = [];
const mockPushModal = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (selector: (s: { jobs: Job[] }) => unknown) => selector({ jobs: mockJobs }),
  usePushModal: () => mockPushModal,
}));

const scopedJob = (over: Partial<Job> = {}): Job =>
  ({
    id: "job-1",
    leadId: "lead-1",
    kind: "estimate",
    svc: "estimate",
    origin: "db",
    title: "Repipe walkthrough",
    addr: "",
    phone: "",
    status: "done",
    archived: false,
    lines: [],
    addons: [],
    photos: ["p/1.jpg", "p/2.jpg", "p/3.jpg"],
    notes: "",
    acts: [],
    visits: [
      {
        id: "v1",
        date: "2026-08-10",
        techId: "tech-1",
        start: 9,
        dur: 1,
        status: "done",
        scopeNotes: "hey office this is what I found blah blah blah",
      },
    ],
    checklist: {
      name: "Repipe walkthrough",
      items: [
        { id: "i1", text: "Measure the run", type: "check", required: true, position: 0 },
        { id: "i2", text: "Photo of the panel", type: "photo", required: true, position: 1 },
      ],
    },
    verify: { ans: { i1: { st: "pass" } } },
    ...over,
  }) as Job;

beforeEach(() => {
  mockJobs = [scopedJob()];
  mockPushModal.mockClear();
});

describe("SiteReference", () => {
  it("shows the tech's notes, the photo count, and the checklist answers", () => {
    render(<SiteReference leadId="lead-1" />);

    expect(screen.getByText("From the site")).toBeTruthy();
    expect(screen.getByText("hey office this is what I found blah blah blah")).toBeTruthy();
    expect(screen.getByText(/3 photos on the walkthrough/)).toBeTruthy();
    expect(screen.getByText("Repipe walkthrough · 1 of 2")).toBeTruthy();
    expect(screen.getByText("Measure the run")).toBeTruthy();
    // A skipped REQUIRED step is what the office most needs to see before pricing.
    expect(screen.getByText(/Photo of the panel · not recorded/)).toBeTruthy();
  });

  it("opens the walkthrough job — the full record is one tap, not a hunt", () => {
    render(<SiteReference leadId="lead-1" />);
    fireEvent.click(screen.getByText("open the walkthrough ›"));
    expect(mockPushModal).toHaveBeenCalledWith("tech-job", { jobId: "job-1" });
  });

  it("renders nothing without a scoped walkthrough — most quotes are not this lane", () => {
    mockJobs = [scopedJob({ visits: [] } as Partial<Job>)];
    const { container } = render(<SiteReference leadId="lead-1" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing with no customer picked yet", () => {
    const { container } = render(<SiteReference leadId={null} />);
    expect(container.innerHTML).toBe("");
  });
});
