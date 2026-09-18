// @vitest-environment jsdom
/**
 * components/modals/placeholder-modals.test.tsx
 * The Clean-up confirm sheet's two-button foot follows the #362 grammar:
 * `.sheet-pri` is width:100% at the CLASS level, so beside Cancel it must take
 * `flex: 1, width: "auto"` (and Cancel `flexShrink: 0`) — otherwise the flex
 * line is over-constrained and the primary crushes into / overlaps Cancel once
 * anything grows the shrink floor.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { CleanUpModalContent } from "./placeholder-modals";

const archiveLead = vi.fn();
const LEAD = { id: "lead-1", name: "Alice Tester", archived: false };

// Mutable so the no-lead branch (disabled primary) can be exercised too.
let leads: unknown[] = [LEAD];

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ params: { leadId: "lead-1" } }),
  useCloseModal: () => vi.fn(),
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ leads, archiveLead }),
}));

describe("CleanUpModalContent — two-button sheet foot (#362)", () => {
  beforeEach(() => {
    leads = [LEAD];
    vi.clearAllMocks();
  });

  it("the confirm primary takes the remaining space and Cancel keeps its intrinsic width", () => {
    render(<CleanUpModalContent />);
    const pri = document.querySelector<HTMLButtonElement>(".sheet-foot .sheet-pri");
    const cancel = document.querySelector<HTMLButtonElement>(".sheet-foot .btn.ghost");
    expect(pri).toBeTruthy();
    expect(cancel).toBeTruthy();
    expect(pri?.style.flexGrow).toBe("1");
    expect(pri?.style.width).toBe("auto");
    expect(cancel?.style.flexShrink).toBe("0");
    expect(cancel?.style.minHeight).toBe("44px");
  });

  it("keeps the foot layout AND the dimmed disabled state when no lead is selected", () => {
    leads = [];
    render(<CleanUpModalContent />);
    const pri = document.querySelector<HTMLButtonElement>(".sheet-foot .sheet-pri");
    expect(pri?.disabled).toBe(true);
    expect(pri?.style.opacity).toBe("0.45");
    expect(pri?.style.flexGrow).toBe("1");
    expect(pri?.style.width).toBe("auto");
  });
});
