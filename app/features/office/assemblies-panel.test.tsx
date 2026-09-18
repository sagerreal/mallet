// @vitest-environment jsdom
/**
 * features/office/assemblies-panel.test.tsx
 * The pricebook Assemblies card. States under test: the level-0 list (name →
 * pricing summary, override hint), the in-flow "your numbers" reveal (dial
 * labels in trade vocabulary, format-aware display values), dial editing
 * (display → raw conversion into saveAssemblyDial), the per-field reset (only
 * when off the shipped value; writes the default back), the failed-save alert,
 * and the empty book. Store mocked; dial math itself is covered in
 * assembly-dials.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { AssemblyView } from "@/lib/store/assemblies-mapper";
import { DEFAULT_ASSEMBLIES } from "@/modules/assemblies/domain/assembly-defaults";
import { getDialValue } from "@/modules/assemblies/domain/assembly-dials";

let storeState: {
  assemblies: AssemblyView[];
  saveAssemblyDial: ReturnType<typeof vi.fn>;
  archiveAssembly: ReturnType<typeof vi.fn>;
};

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) => sel(storeState),
}));

import { AssembliesPanel } from "./assemblies-panel";

/** Server-shaped list items straight from the catalog (dials resolved). */
const catalogViews = (): AssemblyView[] =>
  DEFAULT_ASSEMBLIES.map((entry) => {
    const effective = {
      marginBps: entry.marginBps,
      jobMinimumCents: entry.jobMinimumCents,
      config: entry.config,
    };
    return {
      id: `catalog:${entry.catalogKey}`,
      catalogKey: entry.catalogKey,
      name: entry.name,
      measurementBasis: entry.measurementBasis,
      pricingMode: entry.pricingMode,
      marginBps: entry.marginBps,
      jobMinimumCents: entry.jobMinimumCents,
      config: entry.config,
      active: true,
      isOverride: false,
      dials: entry.dials.map((dial) => ({
        key: dial.key,
        label: dial.label,
        format: dial.format,
        unitSuffix: dial.unitSuffix ?? null,
        currentRaw: getDialValue(effective, dial.target)!,
        defaultRaw: getDialValue(effective, dial.target)!,
      })),
    } as unknown as AssemblyView;
  });

beforeEach(() => {
  storeState = {
    assemblies: catalogViews(),
    saveAssemblyDial: vi.fn().mockResolvedValue({ ok: true }),
    archiveAssembly: vi.fn(),
  };
});

describe("AssembliesPanel — the list", () => {
  it("lists every shipped assembly with how it prices", () => {
    render(<AssembliesPanel />);
    expect(screen.getByText("Driveway replacement, 3-inch")).toBeTruthy();
    // Driveway replacement, overlay, and both roofing recipes ship at cost + 25%.
    expect(screen.getAllByText("Cost + 25%")).toHaveLength(4);
    expect(screen.getByText("Asphalt shingle reroof")).toBeTruthy();
    expect(screen.getByText("Roof tune-up / repair allowance")).toBeTruthy();
    expect(screen.getByText("Sealcoat, two coats")).toBeTruthy();
    expect(screen.getByText("$0.25/sq ft")).toBeTruthy();
    expect(screen.getByText("Crack filling")).toBeTruthy();
    expect(screen.getByText("$1.50/ln ft")).toBeTruthy();
  });

  it("marks an override row as carrying your numbers", () => {
    storeState.assemblies = storeState.assemblies.map((a, i) =>
      i === 0 ? { ...a, isOverride: true } : a,
    );
    render(<AssembliesPanel />);
    expect(screen.getByText("· your numbers")).toBeTruthy();
  });

  it("an emptied book says so instead of rendering a blank card", () => {
    storeState.assemblies = [];
    render(<AssembliesPanel />);
    expect(screen.getByText("No assemblies on your book.")).toBeTruthy();
  });
});

describe("AssembliesPanel — the numbers editor", () => {
  it("opens in-flow with trade-vocabulary dials and format-aware values", () => {
    render(<AssembliesPanel />);
    fireEvent.click(screen.getByText("Driveway replacement, 3-inch"));
    expect(screen.getByLabelText("Asphalt depth")).toBeTruthy();
    expect((screen.getByLabelText("Hot-mix price") as HTMLInputElement).value).toBe("120");
    expect((screen.getByLabelText("Waste") as HTMLInputElement).value).toBe("7");
    expect((screen.getByLabelText("Margin") as HTMLInputElement).value).toBe("25");
    expect((screen.getByLabelText("Job minimum") as HTMLInputElement).value).toBe("2500");
  });

  it("editing a dial converts the display value to raw units for the save", () => {
    render(<AssembliesPanel />);
    fireEvent.click(screen.getByText("Driveway replacement, 3-inch"));
    fireEvent.change(screen.getByLabelText("Hot-mix price"), { target: { value: "135" } });
    expect(storeState.saveAssemblyDial).toHaveBeenCalledWith(
      "catalog:driveway_replacement_3in",
      "hma_price",
      13500, // $135 → cents
    );
  });

  it("a dial off its shipped value grows a Reset that writes the default back", () => {
    storeState.assemblies = storeState.assemblies.map((a) =>
      a.catalogKey === "driveway_replacement_3in"
        ? {
            ...a,
            isOverride: true,
            dials: a.dials.map((d) =>
              d.key === "hma_price" ? { ...d, currentRaw: 13500 } : d,
            ),
          }
        : a,
    );
    render(<AssembliesPanel />);
    fireEvent.click(screen.getByText("Driveway replacement, 3-inch"));
    const reset = screen.getByRole("button", { name: "Reset to $120" });
    fireEvent.click(reset);
    expect(storeState.saveAssemblyDial).toHaveBeenCalledWith(
      "catalog:driveway_replacement_3in",
      "hma_price",
      12000,
    );
  });

  it("no Reset renders while a dial sits on its shipped value", () => {
    render(<AssembliesPanel />);
    fireEvent.click(screen.getByText("Driveway replacement, 3-inch"));
    expect(screen.queryByRole("button", { name: /^Reset to/ })).toBeNull();
  });

  it("a failed save surfaces the alert instead of silently reverting", async () => {
    storeState.saveAssemblyDial = vi.fn().mockResolvedValue({ ok: false });
    render(<AssembliesPanel />);
    fireEvent.click(screen.getByText("Driveway replacement, 3-inch"));
    fireEvent.change(screen.getByLabelText("Hot-mix price"), { target: { value: "135" } });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });

  it("renders the roofing dials in trade vocabulary — prices, per-square labor, waste tiers", () => {
    render(<AssembliesPanel />);
    fireEvent.click(screen.getByText("Asphalt shingle reroof"));
    expect((screen.getByLabelText("Shingle bundles") as HTMLInputElement).value).toBe("42");
    expect((screen.getByLabelText("Install labor") as HTMLInputElement).value).toBe("235");
    expect((screen.getByLabelText("Waste on a cut-up roof") as HTMLInputElement).value).toBe("15");
    expect((screen.getByLabelText("Waste on a simple roof") as HTMLInputElement).value).toBe("10");
    expect((screen.getByLabelText("Pipe boots") as HTMLInputElement).value).toBe("3");
    expect((screen.getByLabelText("Job minimum") as HTMLInputElement).value).toBe("3500");
  });

  it("the ice-dam toggle renders as a checkbox and saves 0/1 through the dial", () => {
    render(<AssembliesPanel />);
    fireEvent.click(screen.getByText("Asphalt shingle reroof"));
    const toggle = screen.getByLabelText("Ice-dam region") as HTMLInputElement;
    expect(toggle.type).toBe("checkbox");
    expect(toggle.checked).toBe(true); // ships ON
    fireEvent.click(toggle);
    expect(storeState.saveAssemblyDial).toHaveBeenCalledWith(
      "catalog:asphalt_shingle_reroof",
      "ice_dam",
      0,
    );
  });

  it("editing a waste tier converts percent to the raw multiplier", () => {
    render(<AssembliesPanel />);
    fireEvent.click(screen.getByText("Asphalt shingle reroof"));
    fireEvent.change(screen.getByLabelText("Waste on a cut-up roof"), { target: { value: "12" } });
    expect(storeState.saveAssemblyDial).toHaveBeenCalledWith(
      "catalog:asphalt_shingle_reroof",
      "waste_cutup",
      1.12,
    );
  });

  it("catalog rows carry no remove control; a custom row does", () => {
    storeState.assemblies = [
      ...storeState.assemblies,
      { ...storeState.assemblies[0]!, id: "row-1", catalogKey: null, name: "My scope", dials: [] },
    ];
    render(<AssembliesPanel />);
    fireEvent.click(screen.getByText("Driveway replacement, 3-inch"));
    expect(screen.queryByRole("button", { name: "Remove assembly" })).toBeNull();
    fireEvent.click(screen.getByText("Driveway replacement, 3-inch")); // close
    fireEvent.click(screen.getByText("My scope"));
    fireEvent.click(screen.getByRole("button", { name: "Remove assembly" }));
    expect(storeState.archiveAssembly).toHaveBeenCalledWith("row-1");
  });
});
