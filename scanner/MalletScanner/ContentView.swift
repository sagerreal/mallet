import RoomPlan
import SwiftUI

/// The whole demo: check the device, scan a room, show the numbers.
///
/// This is deliberately one screen. It exists to prove four things at once on real hardware —
/// signing works, the device has LiDAR, RoomPlan runs, and the measurements we care about come out
/// the other end. Everything else comes later.
struct ContentView: View {
    @State private var isScanning = false
    @State private var measurements: RoomMeasurements?
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Group {
                if !RoomCaptureSession.isSupported {
                    unsupported
                } else if let measurements {
                    ResultsView(measurements: measurements) {
                        self.measurements = nil
                        self.errorMessage = nil
                    }
                } else {
                    start
                }
            }
            .navigationTitle("Mallet Scanner")
            .fullScreenCover(isPresented: $isScanning) {
                RoomScanner(
                    onFinished: { room in
                        measurements = RoomMeasurements(room)
                        isScanning = false
                    },
                    onFailed: { message in
                        errorMessage = message
                        isScanning = false
                    }
                )
                .ignoresSafeArea()
            }
        }
    }

    /// Fail honestly and specifically rather than showing a scan button that cannot work.
    private var unsupported: some View {
        VStack(spacing: 16) {
            Text("This device has no LiDAR sensor")
                .font(.headline)
            Text("Room scanning needs an iPhone Pro (12 Pro or later) or a LiDAR iPad Pro.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }

    private var start: some View {
        VStack(spacing: 20) {
            Image(systemName: "arkit")
                .font(.system(size: 64))
                .foregroundStyle(.tint)

            Text("Scan a room to measure it")
                .font(.headline)

            Text("Walk the room slowly and keep the walls, floor and ceiling line in view.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Button("Start scan") { isScanning = true }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)

            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }
        }
        .padding()
    }
}

/// The numbers, with the bounding-box comparison front and centre — that contrast is the point.
struct ResultsView: View {
    let measurements: RoomMeasurements
    let onScanAgain: () -> Void

    var body: some View {
        List {
            Section("Walls") {
                row("Wall count", "\(measurements.wallCount)")
                row("Wall area (polygon)", ft2(measurements.wallAreaSqFt))
                row("Wall area (bounding box)", ft2(measurements.wallAreaBoundingBoxSqFt))
                if measurements.wallAreaBoundingBoxSqFt > 0 {
                    let delta = (measurements.wallAreaBoundingBoxSqFt - measurements.wallAreaSqFt)
                        / measurements.wallAreaBoundingBoxSqFt * 100
                    row("Difference", String(format: "%.1f%%", delta))
                }
                row("Openings deducted", ft2(measurements.totalOpeningAreaSqFt))
                row("Net wall area", ft2(measurements.wallAreaSqFt - measurements.totalOpeningAreaSqFt))
            }

            Section("Floor & ceiling") {
                row("Floor area", ft2(measurements.floorAreaSqFt))
                row("Ceiling area (derived)", ft2(measurements.ceilingAreaSqFtDerived))
                row("Floor perimeter", String(format: "%.1f ft", measurements.floorPerimeterFt))
                row("Baseboard run", String(format: "%.1f ft",
                                            measurements.floorPerimeterFt - measurements.totalDoorWidthFt))
            }

            Section("Openings") {
                row("Doors", "\(measurements.doors.count)")
                row("Windows", "\(measurements.windows.count)")
                row("Other openings", "\(measurements.otherOpenings.count)")
            }

            Section {
                Button("Scan another room", action: onScanAgain)
            } footer: {
                Text(footnote)
            }
        }
    }

    /// Say out loud what is measured and what is inferred. An estimator bids money off these
    /// numbers — they need to know which ones RoomPlan actually saw.
    private var footnote: String {
        var notes = [
            "Ceiling area is DERIVED from the floor, not measured — RoomPlan has no ceiling concept. It is wrong for a vaulted or sloped ceiling.",
            "Baseboard run subtracts door widths only; it does not yet subtract cased openings.",
        ]
        if !measurements.hasPolygonData {
            notes.insert("No polygon data on this device or OS — wall areas fell back to bounding boxes.", at: 0)
        }
        return notes.joined(separator: "\n\n")
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value).foregroundStyle(.secondary).monospacedDigit()
        }
    }

    private func ft2(_ value: Double) -> String { String(format: "%.0f sq ft", value) }
}
