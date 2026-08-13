// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { A2pRegistrationCard } from "./a2p-registration-card";
import type { A2pStatusView } from "@mallet/a2p";

// Four-state matrix harness — mirrors branding-card.test.tsx's approach of mocking the store
// module directly. This card reads status via the useA2pStatus convenience selector (mirrors
// useActiveModal/useOpenModal in app-store.ts), so the mock only needs to supply that one hook.
let a2pStatus: A2pStatusView | null = null;

vi.mock("@/lib/store/app-store", () => ({
  useA2pStatus: () => a2pStatus,
}));

// FoldCard stub: always renders its children regardless of open/closed state (same stub
// branding-card.test.tsx uses) — this test is about which affordance renders per status, not
// the fold/accordion mechanics.
vi.mock("../fold-card", () => ({
  FoldCard: ({ title, summary, children }: { title: string; summary?: string; children: React.ReactNode }) => (
    <div data-testid="foldcard">
      <div className="fhead">
        <h3>{title}</h3>
        {summary && <span className="fsum">{summary}</span>}
      </div>
      <div className="fbody">{children}</div>
    </div>
  ),
}));

describe("A2pRegistrationCard — four-state matrix", () => {
  beforeEach(() => {
    a2pStatus = null;
  });

  it("not_started (needsInput): shows the Set up texting CTA, no failure text, no pending/active copy", () => {
    a2pStatus = { status: "not_started", canText: false, needsInput: true, failureReason: null };
    render(<A2pRegistrationCard />);
    expect(screen.getByRole("button", { name: /set up texting/i })).toBeTruthy();
    expect(screen.queryByText(/try again/i)).toBeNull();
    expect(screen.queryByText(/being approved/i)).toBeNull();
    expect(screen.queryByText(/texting active/i)).toBeNull();
  });

  it("pending (e.g. profile_pending): shows the quiet 'being approved' status line, no CTA", () => {
    a2pStatus = { status: "profile_pending", canText: false, needsInput: false, failureReason: null };
    render(<A2pRegistrationCard />);
    expect(screen.getByText(/being approved/i)).toBeTruthy();
    // The card promised "usually same day" for months. No shop has had that: 5–7 business days is
    // the 10DLC norm and Mallet's own campaign took weeks. A timescale you miss on the very first
    // shop costs more trust than giving none.
    expect(screen.queryByText(/same day/i)).toBeNull();
    expect(screen.getByText(/5–7 business days/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /set up texting/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
    expect(screen.queryByText(/texting active/i)).toBeNull();
  });

  it("active: shows 'Texting active ✓'", () => {
    a2pStatus = { status: "active", canText: true, needsInput: false, failureReason: null };
    render(<A2pRegistrationCard />);
    expect(screen.getByText(/texting active/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /set up texting/i })).toBeNull();
    expect(screen.queryByText(/being approved/i)).toBeNull();
  });

  it("failed (needsInput): shows the failure reason and a Try again CTA", () => {
    a2pStatus = {
      status: "failed",
      canText: false,
      needsInput: true,
      failureReason: "Twilio rejected: secondary customer profile",
    };
    render(<A2pRegistrationCard />);
    expect(screen.getByText(/twilio rejected: secondary customer profile/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^set up texting$/i })).toBeNull();
  });

  it("loading (status not yet hydrated / null): renders without crashing and shows no state-specific affordance", () => {
    a2pStatus = null;
    render(<A2pRegistrationCard />);
    expect(screen.queryByRole("button", { name: /set up texting/i })).toBeNull();
    expect(screen.queryByText(/texting active/i)).toBeNull();
    expect(screen.queryByText(/being approved/i)).toBeNull();
  });
});
