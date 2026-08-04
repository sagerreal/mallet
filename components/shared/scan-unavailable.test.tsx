// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ScanUnavailable,
  scanBlockerReason,
  scanUnavailableReason,
  type ScanBlocker,
} from "./scan-unavailable";
import type { BlockedRoomScanAvailability } from "@/lib/native/room-scan";

const STATUSES: readonly BlockedRoomScanAvailability["status"][] = [
  "checking",
  "no-lidar",
  "no-native-app",
  "scanner-missing",
];

/** Every blocker the union can express — device statuses plus the two surface blockers. */
const BLOCKERS: readonly ScanBlocker[] = [
  ...STATUSES.map((status) => ({ kind: "device", availability: { status } }) as ScanBlocker),
  { kind: "job-closed" },
  { kind: "no-customer" },
];

const label = (b: ScanBlocker) => (b.kind === "device" ? b.availability.status : b.kind);

const device = (status: BlockedRoomScanAvailability["status"]): ScanBlocker => ({
  kind: "device",
  availability: { status },
});

describe("ScanUnavailable", () => {
  it("renders the surface's own verb as the control label", () => {
    render(<ScanUnavailable blocker={device("no-lidar")} label="Scan a room" />);
    expect(screen.getByRole("button", { name: /Scan a room/ })).toBeTruthy();
  });

  it("names what the device REPORTED, not what phone the user should have bought", () => {
    render(<ScanUnavailable blocker={device("no-lidar")} label="Scan a room" />);
    expect(
      screen.getByText(
        "This device reports no LiDAR sensor — room scanning needs an iPhone Pro or iPad Pro.",
      ),
    ).toBeTruthy();
    // Leads with the report, because the report is not always about the hardware: the iOS
    // Simulator answers isSupported:false too, and the old copy blamed the tester's phone.
    expect(scanUnavailableReason("no-lidar").startsWith("This device reports")).toBe(true);
  });

  it("names the APP as the blocker in a browser, and never mentions an iPhone Pro", () => {
    render(<ScanUnavailable blocker={device("no-native-app")} label="Scan a room" />);
    expect(
      screen.getByText("Open the Mallet iPhone app to scan — a browser cannot reach the LiDAR sensor."),
    ).toBeTruthy();
    // The whole point of the union: telling a desktop user to buy a Pro phone is wrong.
    expect(screen.queryByText(/iPhone Pro or iPad Pro/)).toBeNull();
  });

  it("asks for a newer BUILD when the scanner is not on the bridge — never a restart", () => {
    render(<ScanUnavailable blocker={device("scanner-missing")} label="Scan a room" />);
    expect(
      screen.getByText(
        "This version of the Mallet app is missing the room scanner — update the app in the App Store.",
      ),
    ).toBeTruthy();
    // A missing plugin registration is a shell BUILD fault; "close it and open it again" presents
    // a permanent defect as a glitch the user caused, and cannot possibly fix it.
    expect(scanUnavailableReason("scanner-missing")).not.toMatch(/again|restart|reopen/i);
  });

  it("still gives a reason while the probe is in flight — no bare disabled control", () => {
    render(<ScanUnavailable blocker={device("checking")} label="Scan a room" />);
    expect(screen.getByText("Checking whether this device can scan.")).toBeTruthy();
  });

  it("says the JOB is closed rather than hiding the scanner on a finished job", () => {
    render(<ScanUnavailable blocker={{ kind: "job-closed" }} label="Scan a room" />);
    expect(screen.getByText("This job is closed — reopen it to scan a room.")).toBeTruthy();
  });

  it("asks for a customer rather than hiding the scanner on an empty composer", () => {
    render(<ScanUnavailable blocker={{ kind: "no-customer" }} label="Scan room" />);
    expect(
      screen.getByText("Pick a customer first — a room scan attaches to one of their jobs."),
    ).toBeTruthy();
  });

  it.each(BLOCKERS.map((b) => [label(b), b] as const))(
    "gives %s its own distinct sentence",
    (_name, blocker) => {
      const others = BLOCKERS.filter((b) => b !== blocker).map(scanBlockerReason);
      expect(others).not.toContain(scanBlockerReason(blocker));
      expect(scanBlockerReason(blocker).length).toBeGreaterThan(0);
    },
  );

  it.each(BLOCKERS.map((b) => [label(b), b] as const))(
    "renders %s as a disabled, non-focusable control",
    async (_name, blocker) => {
      render(<ScanUnavailable blocker={blocker} label="Scan a room" />);
      const button = screen.getByRole("button", { name: /Scan a room/ });

      expect(button).toHaveProperty("disabled", true);
      // A real `disabled` attribute (not aria-disabled) keeps it out of the tab order, so it
      // can never be focused and pressed as if it were live.
      await userEvent.tab();
      expect(document.activeElement).not.toBe(button);
    },
  );

  it.each(BLOCKERS.map((b) => [label(b), b] as const))(
    "cannot be activated when %s — a click does nothing",
    async (_name, blocker) => {
      const onClick = vi.fn();
      render(
        <div onClick={onClick}>
          <ScanUnavailable blocker={blocker} label="Scan a room" />
        </div>,
      );
      const button = screen.getByRole("button", { name: /Scan a room/ });

      await userEvent.click(button, { pointerEventsCheck: 0 });

      // A disabled button dispatches no click, so nothing reaches the handler around it.
      expect(onClick).not.toHaveBeenCalled();
    },
  );

  it.each(BLOCKERS.map((b) => [label(b), b] as const))(
    "announces the %s reason with the control via aria-describedby",
    (_name, blocker) => {
      render(<ScanUnavailable blocker={blocker} label="Scan a room" />);
      const button = screen.getByRole("button", { name: /Scan a room/ });
      const describedBy = button.getAttribute("aria-describedby");

      expect(describedBy).toBeTruthy();
      const reason = document.getElementById(describedBy as string);
      expect(reason?.textContent).toBe(scanBlockerReason(blocker));
    },
  );

  it("matches the .btn shape by default and the .linklike shape on request", () => {
    const { unmount } = render(<ScanUnavailable blocker={device("no-lidar")} label="Scan a room" />);
    expect(screen.getByRole("button", { name: /Scan a room/ }).className).toBe("btn sm scanbtn");
    unmount();

    render(<ScanUnavailable blocker={device("no-lidar")} label="Re-scan room" variant="link" />);
    expect(screen.getByRole("button", { name: /Re-scan room/ }).className).toBe("linklike scanbtn");
  });

  it("gives each mounted instance its own reason id — two on a page must not cross-wire", () => {
    render(
      <>
        <ScanUnavailable blocker={device("no-lidar")} label="Scan a room" />
        <ScanUnavailable blocker={device("no-lidar")} label="Re-scan room" />
      </>,
    );
    const ids = screen.getAllByRole("button").map((b) => b.getAttribute("aria-describedby"));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
