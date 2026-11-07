import Foundation
import WorldsRustStore

public enum DrawingValidationError: Error { case requestTooLarge, invalidResponse, invalidScene(String) }

/// Runs the shared original scene validator, not attachment or authorization checks.
public enum OriginalDrawingValidator {
    public static func validate(sceneJSON: Data) throws {
        let scene = try JSONSerialization.jsonObject(with: sceneJSON)
        let request = try JSONSerialization.data(withJSONObject: ["operation": "validate_drawing_scene", "scene": scene])
        guard request.count <= 8 * 1024 * 1024 else { throw DrawingValidationError.requestTooLarge }
        let pointer = request.withUnsafeBytes { worlds_store_call($0.bindMemory(to: UInt8.self).baseAddress, $0.count) }
        guard let pointer else { throw DrawingValidationError.invalidResponse }
        defer { worlds_store_free(pointer) }
        guard let response = String(validatingUTF8: pointer),
              let data = response.data(using: .utf8),
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let ok = object["ok"] as? Bool else { throw DrawingValidationError.invalidResponse }
        if !ok { throw DrawingValidationError.invalidScene(object["error"] as? String ?? "Invalid scene") }
    }
}
