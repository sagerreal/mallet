import MalletCaptureCore
import RoomPlan
import SwiftUI

/// The whole demo: check the device, scan a room, show the numbers.
///
/// This is deliberately one screen. It exists to prove things at once on real hardware — signing
/// works, the device has LiDAR, RoomPlan runs through the `MalletCaptureCore`/`MalletCaptureRoomPlan`
/// pipeline the real app uses, and the measurements we care about come out the other end. The
/// laser-entry fields and JSON export below are the artifact of the ten-room validation walk: a
/// human re-measures the same walls and openings with a laser, and the exported file lets that
/// number get compared against the scan offline, room by room.
@available(iOS 17.0, *)
struct ContentView: View {
    @State private var isScanning = false
    @State private var measurements: RoomMeasurements?
    @State private var coaching: CaptureCoaching?
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
                        isScanning = false
                        do {
                            measurements = try RoomMeasurements(room)
                            errorMessage = nil
                        } catch {
                            errorMessage = "Could not read the scan: \(error)"
                        }
                    },
                    onCoaching: { state in
                        coaching = state
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

            Button("Start scan") {
                coaching = nil
                isScanning = true
            }
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

/// The scan results, the polygon-vs-bounding-box comparison, and the laser-validation entry +
/// export — the artifact of the ten-room gate.
@available(iOS 17.0, *)
struct ResultsView: View {
    let measurements: RoomMeasurements
    let onScanAgain: () -> Void

    @State private var roomName = ""
    @State private var laserWallLengthFt = ""
    @State private var laserWallHeightFt = ""
    @State private var laserOpeningWidthFt = ""
    @State private var laserOpeningHeightFt = ""
    @State private var laserWallLabel = ""
    @State private var exportURL: URL?
    @State private var exportError: String?

    var body: some View {
        List {
            Section("Walls") {
                row("Wall count", "\(measurements.wallCount)")
                row("Wall area (polygon)", ft2(measurements.wallAreaSqFt))
                row("Wall area (bounding box)", ft2(measurements.wallAreaBoundingBoxSqFt))
                if let delta = measurements.boundingBoxDeltaPercent {
                    row("Difference", String(format: "%.1f%%", delta))
                }
                row("Openings deducted", ft2(measurements.totalOpeningAreaSqFt))
                row("Net wall area", ft2(measurements.wallAreaSqFt - measurements.totalOpeningAreaSqFt))
            }

            Section("Floor & ceiling") {
                row("Floor area", ft2(measurements.floorAreaSqFt))
                if let ceiling = measurements.ceilingAreaSqFtDerived {
                    row("Ceiling area (derived)", ft2(ceiling))
                } else {
                    row("Ceiling area", "Vaulted — needs confirmation")
                }
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
                TextField("Room name (e.g. bedroom-2)", text: $roomName)
                    .textInputAutocapitalization(.never)
                laserField("Wall length (ft)", text: $laserWallLengthFt)
                laserField("Wall height (ft)", text: $laserWallHeightFt)
                laserField("Opening width (ft)", text: $laserOpeningWidthFt)
                laserField("Opening height (ft)", text: $laserOpeningHeightFt)
                HStack {
                    Text("Which wall (label)")
                    Spacer()
                    TextField("longest wall", text: $laserWallLabel)
                        .multilineTextAlignment(.trailing)
                        .textInputAutocapitalization(.never)
                }

                Button("Export validation JSON") { export() }
                    .disabled(roomName.trimmingCharacters(in: .whitespaces).isEmpty)

                if let exportError {
                    Text(exportError)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
                if let exportURL {
                    ShareLink(item: exportURL) {
                        Label("Share \(exportURL.lastPathComponent)", systemImage: "square.and.arrow.up")
                    }
                }
            } header: {
                Text("Laser validation")
            } footer: {
                Text("Enter the laser numbers for the same wall and opening the scan measured, then export. This file is the ten-room validation artifact — it is never used for a bid.")
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
        [
            "Ceiling area is DERIVED from the floor, not measured — RoomPlan has no ceiling concept. It is withheld entirely for a vaulted or sloped ceiling rather than approximated.",
            "Baseboard run subtracts door widths only; it does not yet subtract cased openings.",
            "Wall area (bounding box) is shown for comparison only — never bid from it.",
        ].joined(separator: "\n\n")
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value).foregroundStyle(.secondary).monospacedDigit()
        }
    }

    private func laserField(_ label: String, text: Binding<String>) -> some View {
        HStack {
            Text(label)
            Spacer()
            TextField("0.0", text: text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 100)
        }
    }

    private func ft2(_ value: Double) -> String { String(format: "%.0f sq ft", value) }

    // MARK: - Export

    /// Every laser field has exactly three outcomes: empty means "skipped, fine" and exports as
    /// null; a parseable number (accepting either "." or "," as the decimal separator) exports as
    /// that number; anything else is a typo the tech needs to see and fix, not a silent null. The
    /// field's text is never cleared here — the tech needs to see exactly what they typed.
    private enum LaserFieldParse {
        case empty
        case value(Double)
        case invalid
    }

    private func parseLaserField(_ raw: String) -> LaserFieldParse {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return .empty }
        if let value = Double(trimmed.replacingOccurrences(of: ",", with: ".")) {
            return .value(value)
        }
        return .invalid
    }

    /// Parses one field or records the exact field name and raw text against `firstError` so the
    /// export can be blocked with a message that names the problem and the next step.
    private func requireValidLaserField(
        _ raw: String,
        fieldLabel: String,
        firstError: inout String?
    ) -> Double? {
        switch parseLaserField(raw) {
        case .empty:
            return nil
        case .value(let value):
            return value
        case .invalid:
            if firstError == nil {
                firstError = "\(fieldLabel) \"\(raw)\" is not a number. Fix it or clear the field."
            }
            return nil
        }
    }

    private func export() {
        exportError = nil

        var firstError: String?
        let wallLengthFt = requireValidLaserField(
            laserWallLengthFt, fieldLabel: "Wall length", firstError: &firstError)
        let wallHeightFt = requireValidLaserField(
            laserWallHeightFt, fieldLabel: "Wall height", firstError: &firstError)
        let openingWidthFt = requireValidLaserField(
            laserOpeningWidthFt, fieldLabel: "Opening width", firstError: &firstError)
        let openingHeightFt = requireValidLaserField(
            laserOpeningHeightFt, fieldLabel: "Opening height", firstError: &firstError)

        if let firstError {
            exportError = firstError
            return
        }

        let trimmedLabel = laserWallLabel.trimmingCharacters(in: .whitespaces)

        do {
            let record = ValidationRecord(
                roomName: roomName.trimmingCharacters(in: .whitespaces),
                capturedAt: Date(),
                scanGeometry: measurements.geometry,
                laser: ValidationRecord.LaserMeasurements(
                    wallLengthFt: wallLengthFt,
                    wallHeightFt: wallHeightFt,
                    openingWidthFt: openingWidthFt,
                    openingHeightFt: openingHeightFt,
                    wallLabel: trimmedLabel.isEmpty ? nil : trimmedLabel
                )
            )
            let data = try record.encodeJSON()
            let fileName = "validation-\(record.roomName).json"
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
            try data.write(to: url, options: .atomic)
            exportURL = url
        } catch {
            exportError = "Could not export: \(error)"
        }
    }
}

/// The ten-room gate's artifact: the scan's own `NormalizedGeometry` alongside the same wall and
/// opening as re-measured by a laser, so the two can be compared offline, room by room. Never fed
/// back into the app — this is a validation-only record.
struct ValidationRecord: Codable {
    var roomName: String
    var capturedAt: Date
    var scanGeometry: NormalizedGeometry
    var laser: LaserMeasurements

    struct LaserMeasurements: Codable {
        var wallLengthFt: Double?
        var wallHeightFt: Double?
        var openingWidthFt: Double?
        var openingHeightFt: Double?
        /// Free-text label naming which wall/opening the laser measured (e.g. "longest wall",
        /// "entry door"), so the offline comparison isn't biased by guessing which one it was.
        var wallLabel: String?
    }

    func encodeJSON() throws -> Data {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys, .prettyPrinted]
        return try encoder.encode(self)
    }
}
