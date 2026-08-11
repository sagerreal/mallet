// @vitest-environment jsdom
/**
 * features/field-copilot/copilot-section.test.tsx
 *
 * Guards the copilot's extra-work card after the tech modal's Found Work section was
 * retired (change orders carry extra work now):
 *   - the ACCEPT WRITE stays: one tap calls addAddonField (v1.field.addAddon underneath —
 *     proposed-only, feeding the office OK row and the next change order);
 *   - the card's copy points at the CHANGE ORDER, never at the retired section.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CopilotSection } from "./copilot-section";
import type { UseFieldCopilotReturn } from "./use-field-copilot";
import type { Job } from "@/lib/store/types";

// One assistant reply carrying a parsed found-work description — the state that renders the card.
const mockCopilot: UseFieldCopilotReturn = {
  messages: [
    { role: "user", text: "Heater is leaking at the base", foundWork: null },
    { role: "assistant", text: "The anode rod is gone.", foundWork: "Replace anode rod" },
  ],
  pending: false,
  error: null,
  attachedPhotos: [],
  ask: vi.fn(() => Promise.resolve()),
  attachPhoto: vi.fn(),
  detachPhoto: vi.fn(),
  clearError: vi.fn(),
};

vi.mock("./use-field-copilot", () => ({
  useFieldCopilot: () => mockCopilot,
}));

vi.mock("./use-push-to-talk", () => ({
  usePushToTalk: () => ({
    supported: false,
    listening: false,
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

// Keep supabase/canvas out of jsdom — the camera path is not under test here.
vi.mock("@/lib/store/upload-field-photo", () => ({ uploadFieldPhoto: vi.fn() }));
vi.mock("@/lib/images/downscale", () => ({ downscaleImage: vi.fn() }));
vi.mock("@/features/counter/artifacts", () => ({ AiThinkingBlock: () => null }));

const job = { id: "job-1", title: "Fix water heater", addons: [] } as unknown as Job;

const mockAddAddonField = vi.fn();

beforeEach(() => {
  mockAddAddonField.mockClear();
});

describe("CopilotSection — the extra-work card", () => {
  it("one tap stages the item as a proposed add-on via addAddonField (the write stays)", () => {
    render(<CopilotSection job={job} addAddonField={mockAddAddonField} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to change order" }));
    expect(mockAddAddonField).toHaveBeenCalledTimes(1);
    expect(mockAddAddonField).toHaveBeenCalledWith("job-1", { d: "Replace anode rod", r: 0 });
  });

  it("confirms the add and refuses a second tap (no duplicate add-ons)", () => {
    render(<CopilotSection job={job} addAddonField={mockAddAddonField} />);
    const btn = screen.getByRole("button", { name: "Add to change order" });
    fireEvent.click(btn);
    const added = screen.getByRole("button", { name: "Added to the change order" });
    expect((added as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(added);
    expect(mockAddAddonField).toHaveBeenCalledTimes(1);
  });

  it("never points the tech at the retired Found Work section", () => {
    render(<CopilotSection job={job} addAddonField={mockAddAddonField} />);
    // The description itself still renders; no control or caption may say "found work".
    expect(screen.getByText("Replace anode rod")).toBeTruthy();
    expect(screen.queryByText(/found work/i)).toBeNull();
  });
});
