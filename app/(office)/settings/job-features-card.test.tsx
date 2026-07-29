// @vitest-environment jsdom
/**
 * app/(office)/settings/job-features-card.test.tsx
 *
 * Guards the org-level measurement-estimating switch: defaults off, renders the
 * functional copy, and setToggle is called with the right key/value on flip.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JobFeaturesCard } from "./job-features-card";

const setToggle = vi.fn();
let measurementEstimating = false;

let storeState: { toggles: { measurementEstimating: boolean }; setToggle: typeof setToggle };

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: typeof storeState) => unknown) => sel(storeState),
}));

vi.mock("./fold-card", () => ({
  FoldCard: ({ title, summary, children }: { title: string; summary?: string; children: React.ReactNode }) => (
    <div data-testid="foldcard">
      <div className="fhead"><h3>{title}</h3>{summary && <span className="fsum">{summary}</span>}</div>
      <div className="fbody">{children}</div>
    </div>
  ),
}));

describe("JobFeaturesCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    measurementEstimating = false;
    storeState = { toggles: { measurementEstimating }, setToggle };
  });

  it("renders the measurement estimating row with functional copy, unchecked by default", () => {
    render(<JobFeaturesCard />);
    expect(screen.getByText("Measurement estimating")).toBeTruthy();
    expect(
      screen.getByText(/Scan or enter room measurements on jobs, and price from them/),
    ).toBeTruthy();
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it("checking the switch calls setToggle('measurementEstimating', true)", () => {
    render(<JobFeaturesCard />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(setToggle).toHaveBeenCalledWith("measurementEstimating", true);
  });

  it("reflects an on org — checkbox checked and summary shown", () => {
    storeState = { toggles: { measurementEstimating: true }, setToggle };
    render(<JobFeaturesCard />);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(screen.getByText("measurement estimating on")).toBeTruthy();
  });
});
