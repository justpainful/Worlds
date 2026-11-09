import XCTest
import SceneKit
@testable import Worlds3DViews

final class Worlds3DLoaderTests: XCTestCase {
    func testRecognizesSupportedExtensions() {
        XCTAssertTrue(Worlds3D.isSupported(name: "engine_bracket.dxf"))
        XCTAssertTrue(Worlds3D.isSupported(name: "case.stl"))
        XCTAssertTrue(Worlds3D.isSupported(name: "avatar.usdz"))
        XCTAssertTrue(Worlds3D.isSupported(name: "robot.gltf"))
        XCTAssertTrue(Worlds3D.isSupported(name: "scene.glb"))
        XCTAssertTrue(Worlds3D.isSupported(name: "chair.obj"))
        XCTAssertFalse(Worlds3D.isSupported(name: "report.docx"))
        XCTAssertFalse(Worlds3D.isSupported(name: "sheet.xlsx"))
        XCTAssertFalse(Worlds3D.isSupported(name: "photo.jpg"))
    }

    func testDetectsCADVs3D() {
        XCTAssertEqual(Model3DFormat.dxf.isCAD, true)
        XCTAssertEqual(Model3DFormat.stl.isCAD, true)
        XCTAssertEqual(Model3DFormat.usdz.isCAD, false)
        XCTAssertEqual(Model3DFormat.gltf.isCAD, false)
    }

    func testDefaultRenderModes() {
        XCTAssertEqual(Model3DFormat.dxf.defaultRenderMode, .wireframe)
        XCTAssertEqual(Model3DFormat.stl.defaultRenderMode, .shadedWireframe)
        XCTAssertEqual(Model3DFormat.usdz.defaultRenderMode, .shaded)
    }

    func testSceneNormalizationSetsUpCameraAndLighting() throws {
        let asciiSTL = """
        solid cube
          facet normal 0.0 0.0 1.0
            outer loop
              vertex 0.0 0.0 0.0
              vertex 50.0 0.0 0.0
              vertex 0.0 50.0 0.0
            endloop
          endfacet
        endsolid cube
        """
        let data = asciiSTL.data(using: .utf8)!
        let loaded = try Worlds3DSceneLoader.load(data: data, format: .stl)

        let root = loaded.scene.rootNode
        // Check for content container
        XCTAssertNotNil(root.childNode(withName: "content-container", recursively: false))
        // Check for 3-point lights
        XCTAssertNotNil(root.childNode(withName: "lighting-ambient", recursively: false))
        XCTAssertNotNil(root.childNode(withName: "lighting-key", recursively: false))
        XCTAssertNotNil(root.childNode(withName: "lighting-fill", recursively: false))
        // Check for primary camera
        XCTAssertNotNil(root.childNode(withName: "primary-camera", recursively: false))
    }
}
