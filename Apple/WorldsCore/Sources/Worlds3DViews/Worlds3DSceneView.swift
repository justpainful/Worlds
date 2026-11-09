import SwiftUI
@preconcurrency import SceneKit

/// Cross-platform SwiftUI Representable embedding SceneKit SCNView with gestures and camera controls.
public struct Worlds3DSceneView: View {
    public let scene: SCNScene
    public let renderMode: Model3DRenderMode
    public let cameraPreset: Model3DCameraPreset
    public let allowsCameraControl: Bool
    public let backgroundColor: SCNColor

    public init(
        scene: SCNScene,
        renderMode: Model3DRenderMode = .shaded,
        cameraPreset: Model3DCameraPreset = .isometric,
        allowsCameraControl: Bool = true,
        backgroundColor: SCNColor = SCNColor.clear
    ) {
        self.scene = scene
        self.renderMode = renderMode
        self.cameraPreset = cameraPreset
        self.allowsCameraControl = allowsCameraControl
        self.backgroundColor = backgroundColor
    }

    public var body: some View {
        #if os(macOS)
        MacSCNView(
            scene: scene,
            renderMode: renderMode,
            cameraPreset: cameraPreset,
            allowsCameraControl: allowsCameraControl,
            backgroundColor: backgroundColor
        )
        #else
        IOSSCNView(
            scene: scene,
            renderMode: renderMode,
            cameraPreset: cameraPreset,
            allowsCameraControl: allowsCameraControl,
            backgroundColor: backgroundColor
        )
        #endif
    }
}

private func applyRenderMode(_ renderMode: Model3DRenderMode, to scene: SCNScene) {
    scene.rootNode.enumerateHierarchy { node, _ in
        if let geometry = node.geometry {
            for material in geometry.materials {
                switch renderMode {
                case .shaded:
                    material.fillMode = .fill
                case .wireframe:
                    material.fillMode = .lines
                case .shadedWireframe:
                    material.fillMode = .fill
                }
            }
        }
    }
}

private func applyCameraPreset(_ preset: Model3DCameraPreset, to scnView: SCNView) {
    guard let cameraNode = scnView.pointOfView ?? scnView.scene?.rootNode.childNode(withName: "primary-camera", recursively: true) else { return }

    SCNTransaction.begin()
    SCNTransaction.animationDuration = 0.5
    switch preset {
    case .isometric:
        cameraNode.position = SCNVector3(10, 10, 10)
        cameraNode.eulerAngles = SCNVector3(-Float.pi / 5.0, Float.pi / 4.0, 0)
    case .front:
        cameraNode.position = SCNVector3(0, 0, 14)
        cameraNode.eulerAngles = SCNVector3Zero
    case .top:
        cameraNode.position = SCNVector3(0, 14, 0)
        cameraNode.eulerAngles = SCNVector3(-Float.pi / 2.0, 0, 0)
    case .side:
        cameraNode.position = SCNVector3(14, 0, 0)
        cameraNode.eulerAngles = SCNVector3(0, Float.pi / 2.0, 0)
    }
    SCNTransaction.commit()
}

#if os(macOS)
import AppKit

private struct MacSCNView: NSViewRepresentable {
    let scene: SCNScene
    let renderMode: Model3DRenderMode
    let cameraPreset: Model3DCameraPreset
    let allowsCameraControl: Bool
    let backgroundColor: SCNColor

    func makeNSView(context: Context) -> SCNView {
        let view = SCNView()
        configureView(view)
        return view
    }

    func updateNSView(_ view: SCNView, context: Context) {
        if view.scene !== scene {
            view.scene = scene
        }
        view.allowsCameraControl = allowsCameraControl
        view.backgroundColor = backgroundColor
        applyRenderMode(renderMode, to: scene)

        if context.coordinator.lastPreset != cameraPreset {
            context.coordinator.lastPreset = cameraPreset
            applyCameraPreset(cameraPreset, to: view)
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(initialPreset: cameraPreset)
    }

    private func configureView(_ view: SCNView) {
        view.scene = scene
        view.allowsCameraControl = allowsCameraControl
        view.autoenablesDefaultLighting = false
        view.antialiasingMode = .multisampling4X
        view.backgroundColor = backgroundColor
        applyRenderMode(renderMode, to: scene)
        applyCameraPreset(cameraPreset, to: view)
    }

    class Coordinator {
        var lastPreset: Model3DCameraPreset
        init(initialPreset: Model3DCameraPreset) {
            self.lastPreset = initialPreset
        }
    }
}

#else
import UIKit

private struct IOSSCNView: UIViewRepresentable {
    let scene: SCNScene
    let renderMode: Model3DRenderMode
    let cameraPreset: Model3DCameraPreset
    let allowsCameraControl: Bool
    let backgroundColor: SCNColor

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        configureView(view)
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {
        if view.scene !== scene {
            view.scene = scene
        }
        view.allowsCameraControl = allowsCameraControl
        view.backgroundColor = backgroundColor
        applyRenderMode(renderMode, to: scene)

        if context.coordinator.lastPreset != cameraPreset {
            context.coordinator.lastPreset = cameraPreset
            applyCameraPreset(cameraPreset, to: view)
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(initialPreset: cameraPreset)
    }

    private func configureView(_ view: SCNView) {
        view.scene = scene
        view.allowsCameraControl = allowsCameraControl
        view.autoenablesDefaultLighting = false
        view.antialiasingMode = .multisampling4X
        view.backgroundColor = backgroundColor
        applyRenderMode(renderMode, to: scene)
        applyCameraPreset(cameraPreset, to: view)
    }

    class Coordinator {
        var lastPreset: Model3DCameraPreset
        init(initialPreset: Model3DCameraPreset) {
            self.lastPreset = initialPreset
        }
    }
}
#endif
