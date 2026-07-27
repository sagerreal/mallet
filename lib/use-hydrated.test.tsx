// @vitest-environment jsdom
/**
 * lib/use-hydrated.test.tsx
 *
 * useHydrated exists to close a credential leak, so its one contract matters:
 * it must report FALSE for the server-rendered markup and the first client
 * render, and only flip true once effects have run.
 *
 * Why: every auth form is a native <form> whose onSubmit handler only exists
 * after React attaches. Submitted before then, the browser performs its default
 * submission and — with no method= — that is a GET, which puts the password in
 * the URL, the history entry and every access log in between. Measured window
 * on a 4x-CPU-throttled phone over 1.5 Mbps: 630 ms.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { render, screen } from "@testing-library/react";
import { useHydrated } from "./use-hydrated";

function Probe() {
  const hydrated = useHydrated();
  return <span data-testid="state">{hydrated ? "hydrated" : "pending"}</span>;
}

describe("useHydrated", () => {
  it("reports pending in server-rendered markup", () => {
    // The markup a phone paints before any JS has run.
    expect(renderToStaticMarkup(<Probe />)).toContain("pending");
  });

  it("reports hydrated once effects have run on the client", () => {
    render(<Probe />);
    expect(screen.getByTestId("state").textContent).toBe("hydrated");
  });
});
