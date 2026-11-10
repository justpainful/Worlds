# Worlds3DViews

`Worlds3DViews` provides native 3D and CAD viewing capability across Apple platforms (iOS, iPadOS, macOS) via SceneKit, RealityKit, and Metal.

## Supported Formats

- `.usdz`: Universal Scene Description (native iOS/macOS AR/3D format)
- `.obj`: Wavefront OBJ with material definition
- `.stl`: Stereolithography (both Binary and ASCII STL with automatic format detection)
- `.gltf`: glTF 2.0 scene description
- `.glb`: Binary glTF 2.0 container
- `.dxf`: AutoCAD ASCII Drawing Exchange Format (LINE, 3DFACE, CIRCLE, ARC, LWPOLYLINE, POLYLINE)

## Architecture

- **`Worlds3DModel`**: Format enumeration, render modes (`shaded`, `wireframe`, `shadedWireframe`), camera presets (`isometric`, `front`, `top`, `side`), and geometry statistics computation.
- **`CADDXFParser`**: Zero-dependency parser converting 2D and 3D CAD drawing entities into SceneKit wireframe and polygonal geometry nodes.
- **`STLParser`**: High-performance parser extracting indexed triangle meshes, normals, and bounds from binary and ASCII STL files.
- **`GLTFParser`**: glTF 2.0 / GLB binary chunk parser extracting vertex attributes, normals, and indices.
- **`Worlds3DSceneLoader`**: Normalization engine that centers objects at the origin, fits scale to standard viewing bounds, and adds a professional 3-point studio lighting setup (ambient, key directional with shadows, fill directional).
- **`Worlds3DSceneView`**: Cross-platform SwiftUI representable (`UIViewRepresentable` on iOS / `NSViewRepresentable` on macOS) wrapping `SCNView` with orbital camera gestures (drag to rotate, pinch to zoom, pan).
- **`Worlds3DContentView`**: Full interactive SwiftUI view with floating glass HUD (vertex count, face/line count, dimensions) and controls (render mode, camera presets, statistics).
