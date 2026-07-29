/// Coaching states emitted during a room capture to guide the user. Each state
/// corresponds to a RoomPlan instruction and carries user-facing guidance copy.
public enum CaptureCoaching: String, Codable, Sendable {
    case lowTexture
    case turnOnLight
    case deviceTooHot
    case sceneTooLarge

    /// User-facing guidance string for this coaching state.
    public var guidance: String {
        switch self {
        case .lowTexture:
            return "Blank wall — aim at a corner or an edge and keep moving."
        case .turnOnLight:
            return "Too dark to scan. Turn on the lights or open a door."
        case .deviceTooHot:
            return "Phone is overheating. Pause here — the scan is saved. Let it cool."
        case .sceneTooLarge:
            return "This space is too big for one scan. Finish this room and scan the next separately."
        }
    }
}
