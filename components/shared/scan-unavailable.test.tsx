// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScanUnavailable, scanUnavailableReason } from "./scan-unavailable";
import type { BlockedRoomScanAvailability } from "@/lib/native/room-scan";

const STATUSES: readonly BlockedRoomScanAvailability["status"][] = [
  "checking",
  "no-lidar",
  "no-native-app",
  "scanner-missing",
];

describe("ScanUnavailable", () => {
  it("renders the surface's own verb as the control label", () => {
    render(<ScanUnavailable availability={{ status: "no-lidar" }} label="Scan a room" />);
    expect(screen.getByRole("button", { name: /Scan a room/ })).toBeTruthy();
  });

  it("names the DEVICE as the blocker when the plugin says there is no LiDAR", () => {
    render(<ScanUnavailable availability={{ status: "no-lidar" }} label="Scan a room" />);
    expect(
      screen.getByText("Needs an iPhone Pro or iPad Pro — room scanning uses the LiDAR sensor."),
    ).toBeTruthy();
  });

  it("names the APP as the blocker in a browser, and never mentions an iPhone Pro", () => {
    render(<ScanUnavailable availability={{ status: "no-native-app" }} label="Scan a room" />);
    expect(
      screen.getByText("Open the Mallet iPhone app to scan — a browser cannot reach the LiDAR sensor."),
    ).toBeTruthy();
    // The whole point of the union: telling a desktop user to buy a Pro phone is wrong.
    expect(screen.queryByText(/iPhone Pro or iPad Pro/)).toBeNull();
  });

  it("tells the user to reopen the app when the scanner did not load", () => {
    render(<ScanUnavailable availability={{ status: "scanner-missing" }} label="Scan a room" />);
    expect(screen.getByText("The scanner did not load. Close the Mallet app and open it again.")).toBeTruthy();
  });

  it("still gives a reason while the probe is in flight — no bare disabled control", () => {
    render(<ScanUnavailable availability={{ status: "checking" }} label="Scan a room" />);
    expect(screen.getByText("Checking whether this device can scan.")).toBeTruthy();
  });

  it.each(STATUSES)("gives %s its own distinct sentence", (status) => {
    const others = STATUSES.filter((s) => s !== status).map(scanUnavailableReason);
    expect(others).not.toContain(scanUnavailableReason(status));
    expect(scanUnavailableReason(status).length).toBeGreaterThan(0);
  });

  it.each(STATUSES)("renders %s as a disabled, non-focusable control", async (status) => {
    render(<ScanUnavailable availability={{ status }} label="Scan a room" />);
    const button = screen.getByRole("button", { name: /Scan a room/ });

    expect(button).toHaveProperty("disabled", true);
    // A real `disabled` attribute (not aria-disabled) keeps it out of the tab order, so it
    // can never be focused and pressed as if it were live.
    await userEvent.tab();
    expect(document.activeElement).not.toBe(button);
  });

  it.each(STATUSES)("cannot be activated when %s — a click does nothing", async (status) => {
    const onClick = vi.fn();
    render(
      <div onClick={onClick}>
        <ScanUnavailable availability={{ status }} label="Scan a room" />
      </div>,
    );
    const button = screen.getByRole("button", { name: /Scan a room/ });

    await userEvent.click(button, { pointerEventsCheck: 0 });

    // A disabled button dispatches no click, so nothing reaches the handler around it.
    expect(onClick).not.toHaveBeenCalled();
  });

  it.each(STATUSES)("announces the %s reason with the control via aria-describedby", (status) => {
    render(<ScanUnavailable availability={{ status }} label="Scan a room" />);
    const button = screen.getByRole("button", { name: /Scan a room/ });
    const describedBy = button.getAttribute("aria-describedby");

    expect(describedBy).toBeTruthy();
    const reason = document.getElementById(describedBy as string);
    expect(reason?.textContent).toBe(scanUnavailableReason(status));
  });

  it("matches the .btn shape by default and the .linklike shape on request", () => {
    const { unmount } = render(<ScanUnavailable availability={{ status: "no-lidar" }} label="Scan a room" />);
    expect(screen.getByRole("button", { name: /Scan a room/ }).className).toBe("btn sm scanbtn");
    unmount();

    render(<ScanUnavailable availability={{ status: "no-lidar" }} label="Re-scan room" variant="link" />);
    expect(screen.getByRole("button", { name: /Re-scan room/ }).className).toBe("linklike scanbtn");
  });

  it("gives each mounted instance its own reason id — two on a page must not cross-wire", () => {
    render(
      <>
        <ScanUnavailable availability={{ status: "no-lidar" }} label="Scan a room" />
        <ScanUnavailable availability={{ status: "no-lidar" }} label="Re-scan room" />
      </>,
    );
    const ids = screen.getAllByRole("button").map((b) => b.getAttribute("aria-describedby"));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
