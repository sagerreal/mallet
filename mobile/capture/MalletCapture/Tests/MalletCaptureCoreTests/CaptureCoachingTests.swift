import XCTest
@testable import MalletCaptureCore

final class CaptureCoachingTests: XCTestCase {
    func testLowTextureGuidance() {
        XCTAssertEqual(
            CaptureCoaching.lowTexture.guidance,
            "Blank wall — aim at a corner or an edge and keep moving."
        )
    }

    func testTurnOnLightGuidance() {
        XCTAssertEqual(
            CaptureCoaching.turnOnLight.guidance,
            "Too dark to scan. Turn on the lights or open a door."
        )
    }

    func testDeviceTooHotGuidance() {
        XCTAssertEqual(
            CaptureCoaching.deviceTooHot.guidance,
            "Phone is overheating. Pause here — the scan is saved. Let it cool."
        )
    }

    func testSceneTooLargeGuidance() {
        XCTAssertEqual(
            CaptureCoaching.sceneTooLarge.guidance,
            "This space is too big for one scan. Finish this room and scan the next separately."
        )
    }

    func testRawValues() {
        XCTAssertEqual(CaptureCoaching.lowTexture.rawValue, "lowTexture")
        XCTAssertEqual(CaptureCoaching.turnOnLight.rawValue, "turnOnLight")
        XCTAssertEqual(CaptureCoaching.deviceTooHot.rawValue, "deviceTooHot")
        XCTAssertEqual(CaptureCoaching.sceneTooLarge.rawValue, "sceneTooLarge")
    }

    func testCodableRoundTrip() throws {
        let original = CaptureCoaching.lowTexture
        let encoded = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(CaptureCoaching.self, from: encoded)
        XCTAssertEqual(original, decoded)
    }

    func testCodableRoundTripAllCases() throws {
        let cases: [CaptureCoaching] = [
            .lowTexture,
            .turnOnLight,
            .deviceTooHot,
            .sceneTooLarge
        ]
        for original in cases {
            let encoded = try JSONEncoder().encode(original)
            let decoded = try JSONDecoder().decode(CaptureCoaching.self, from: encoded)
            XCTAssertEqual(original, decoded)
        }
    }
}
