// @vitest-environment jsdom
/**
 * features/settings/measurement-gate-provider.test.tsx
 *
 * The merge rule between the SERVER seed (rendered into the first HTML by the office/field
 * layouts) and the client store (written by the settings hydrators, and by setTrade).
 *
 * What this protects: the seed exists so a non-measuring shop — 10 of the 12 live orgs are
 * plumbing with measuring off — never sees the Measure card paint and then vanish. If the hook
 * ever preferred the raw store, the store's `"unknown"` placeholder would win on the first paint
 * and the flash would be straight back.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { MeasurementGate } from "@/lib/measurement-gate";

let storedGate: MeasurementGate = "unknown";

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ toggles: { measurementEstimating: storedGate } }),
}));

const { MeasurementGateProvider, useMeasurementGate } = await import("./measurement-gate-provider");

function Probe() {
  return <span data-testid="gate">{useMeasurementGate()}</span>;
}

const gateText = () => screen.getByTestId("gate").textContent;

beforeEach(() => {
  storedGate = "unknown";
});

describe("useMeasurementGate", () => {
  it("uses the server seed while the store still holds its unknown placeholder", () => {
    render(
      <MeasurementGateProvider gate="off">
        <Probe />
      </MeasurementGateProvider>,
    );
    // The whole point: first paint, no hydrator has run, and the answer is already "off".
    expect(gateText()).toBe("off");
  });

  it("prefers the store once a hydrator (or setTrade) has written a real answer", () => {
    storedGate = "on";
    render(
      <MeasurementGateProvider gate="off">
        <Probe />
      </MeasurementGateProvider>,
    );
    // A live client read beats a seed taken at page-render time — setTrade can grant measuring
    // mid-session and the surfaces must follow it without a reload.
    expect(gateText()).toBe("on");
  });

  it("reports unknown only when BOTH the seed and the store are unknown", () => {
    render(
      <MeasurementGateProvider gate="unknown">
        <Probe />
      </MeasurementGateProvider>,
    );
    // Server read failed AND no client read has landed — the genuine failure the tri-state names,
    // which the surfaces render as a disabled control with a stated reason.
    expect(gateText()).toBe("unknown");
  });

  it("degrades to unknown with no provider — never to a fabricated off", () => {
    render(<Probe />);
    // A tree without the provider must fail OPEN (visible, disabled, explained), not silently
    // delete the scanner the way a default of "off" would.
    expect(gateText()).toBe("unknown");
  });
});
