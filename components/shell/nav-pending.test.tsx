// @vitest-environment jsdom
/**
 * components/shell/nav-pending.test.tsx
 *
 * A sidebar tap that crosses shells (office ⇄ field are separate route trees) can take a beat,
 * and the item gave no sign it had been pressed — so the tap read as a dead control and got
 * repeated. The marker below is what the stylesheet keys the pending row off.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const status = vi.hoisted(() => ({ pending: false }));

// Only the hook is needed: NavPending renders INSIDE a <Link>, and useLinkStatus reads that
// link's context — which is exactly why it cannot live in the component that renders the Link.
vi.mock("next/link", () => ({ useLinkStatus: () => status }));

import { NavPending } from "./nav-pending";

describe("NavPending", () => {
  beforeEach(() => {
    status.pending = false;
  });

  it("renders nothing while the link is idle — no badge slot is taken", () => {
    const { container } = render(<NavPending />);
    expect(container.querySelector(".navpend")).toBeNull();
  });

  it("marks the row the moment the navigation is pending", () => {
    status.pending = true;
    const { container } = render(<NavPending />);
    const mark = container.querySelector(".navpend");
    expect(mark).toBeTruthy();
    // Decoration: the row it sits in is already named by its own link text.
    expect(mark!.getAttribute("aria-hidden")).toBe("true");
  });
});
