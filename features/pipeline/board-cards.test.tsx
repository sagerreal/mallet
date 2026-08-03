// @vitest-environment jsdom
/**
 * features/pipeline/board-cards.test.tsx
 * The scoped card's "quote it ›" must hand the composer BOTH ids: the lead (who the quote is
 * for) and the scope-visit job (?job=), so the drafted quote points back at the walkthrough and
 * accepting it converts that job instead of minting a twin.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GettingCard } from "./board-cards";
import type { GettingRow } from "./working";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: unknown) => unknown) =>
    sel({ dismissAttention: vi.fn(), undismissAttention: vi.fn() }),
  useOpenModal: () => vi.fn(),
}));

const scopedRow: GettingRow = {
  lead: { id: "lead-1", name: "Dana Fox", job: "Repipe", age: 1 } as never,
  est: null,
  kind: "scoped",
  stamp: "scoped",
  verb: "quote it ›",
  scopeVisitJobId: "job-9",
};

describe("GettingCard — quote it ›", () => {
  it("hands the composer the lead AND the scope-visit job", () => {
    push.mockClear();
    render(<GettingCard row={scopedRow} />);
    fireEvent.click(screen.getByRole("button", { name: "quote it ›" }));
    expect(push).toHaveBeenCalledWith("/composer?lead=lead-1&job=job-9");
  });

  it("omits &job= when the row has no walkthrough job behind it", () => {
    push.mockClear();
    render(<GettingCard row={{ ...scopedRow, scopeVisitJobId: null }} />);
    fireEvent.click(screen.getByRole("button", { name: "quote it ›" }));
    expect(push).toHaveBeenCalledWith("/composer?lead=lead-1");
  });
});
