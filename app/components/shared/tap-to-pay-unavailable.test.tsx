// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TapToPayUnavailable, tapToPayReason } from "./tap-to-pay-unavailable";
import type { TapToPayAvailability } from "@/lib/native/tap-to-pay";

const STATUSES: readonly TapToPayAvailability["status"][] = [
  "checking",
  "ready",
  "no-native-app",
  "plugin-missing",
  "unsupported-device",
];

describe("TapToPayUnavailable", () => {
  it("renders a real disabled button with the label, never a hidden or live one", () => {
    render(<TapToPayUnavailable availability={{ status: "plugin-missing" }} />);
    const button = screen.getByRole("button", { name: /Tap to Pay/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("names the honest PR1 state in the shell: the feature arrives with the next app update", () => {
    render(<TapToPayUnavailable availability={{ status: "plugin-missing" }} />);
    expect(screen.getByText("Tap to Pay arrives with the next app update.")).toBeTruthy();
  });

  it("names the APP as the blocker in a browser — a desktop cannot read a card", () => {
    render(<TapToPayUnavailable availability={{ status: "no-native-app" }} />);
    expect(
      screen.getByText("Tap to Pay needs the Mallet iPhone app — this browser can't read a card."),
    ).toBeTruthy();
  });

  it("wires the reason to the button for screen readers (aria-describedby)", () => {
    render(<TapToPayUnavailable availability={{ status: "unsupported-device" }} />);
    const button = screen.getByRole("button", { name: /Tap to Pay/ });
    const describedBy = button.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const reason = document.getElementById(describedBy as string);
    expect(reason?.textContent).toBe(tapToPayReason({ status: "unsupported-device" }));
  });

  it("has a real sentence for EVERY status — no state may render a dimmed control with no reason", () => {
    for (const status of STATUSES) {
      const sentence = tapToPayReason({ status } as TapToPayAvailability);
      expect(sentence.length).toBeGreaterThan(10);
    }
  });

  it("even a `ready` probe answer stays disabled in this app version — the web flow ships with the plugin", () => {
    render(<TapToPayUnavailable availability={{ status: "ready" }} />);
    const button = screen.getByRole("button", { name: /Tap to Pay/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Tap to Pay arrives with the next app update.")).toBeTruthy();
  });
});
