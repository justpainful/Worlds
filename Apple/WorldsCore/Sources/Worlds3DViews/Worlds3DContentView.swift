import SwiftUI
import SceneKit
import WorldsMedia

/// Complete interactive SwiftUI viewer for 3D and CAD files (.usdz, .obj, .stl, .gltf, .glb, .dxf).
public struct Worlds3DContentView: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var loadedScene: Worlds3DSceneLoader.LoadedScene?
    @State private var renderMode: Model3DRenderMode = .shaded
    @State private var cameraPreset: Model3DCameraPreset = .isometric
    @State private var showStatsHUD = true
    @State private var isLoading = true
    @State private var errorMessage: String?

    public let sourceURL: URL?
    public let sourceData: Data?
    public let fileName: String

    public init(url: URL, fileName: String? = nil) {
        self.sourceURL = url
        self.sourceData = nil
        self.fileName = fileName ?? url.lastPathComponent
    }

    public init(data: Data, fileName: String) {
        self.sourceURL = nil
        self.sourceData = data
        self.fileName = fileName
    }

    public var body: some View {
        ZStack {
            viewportBackground
                .ignoresSafeArea()

            if isLoading {
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Loading 3D model…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else if let error = errorMessage {
                VStack(spacing: 14) {
                    Image(systemName: "cube.transparent")
                        .font(.system(size: 40))
                        .foregroundStyle(.secondary)
                    Text("Unable to display 3D model")
                        .font(.headline)
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                    Button("Try Again") {
                        loadScene()
                    }
                    .buttonStyle(.bordered)
                }
            } else if let loaded = loadedScene {
                Worlds3DSceneView(
                    scene: loaded.scene,
                    renderMode: renderMode,
                    cameraPreset: cameraPreset,
                    allowsCameraControl: true,
                    backgroundColor: SCNColor.clear
                )
                .ignoresSafeArea(edges: .bottom)

                // Floating Overlay Controls
                VStack {
                    if showStatsHUD {
                        statsHUD(loaded.stats, format: loaded.format)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }

                    Spacer()

                    bottomControlToolbar
                }
                .padding()
            }
        }
        .onAppear {
            loadScene()
        }
    }

    private var viewportBackground: Color {
        colorScheme == .dark
            ? Color(red: 0.08, green: 0.08, blue: 0.10)
            : Color(red: 0.96, green: 0.96, blue: 0.97)
    }

    @ViewBuilder
    private func statsHUD(_ stats: Model3DStats, format: Model3DFormat) -> some View {
        HStack(spacing: 12) {
            Label(format.displayName, systemImage: format.isCAD ? "compass.drawing" : "cube")
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color.accentColor.opacity(0.15), in: Capsule())
                .foregroundStyle(Color.accentColor)

            Divider()
                .frame(height: 16)

            Text("\(stats.vertexCount) vertices")
                .font(.caption)
                .foregroundStyle(.secondary)

            if stats.faceCount > 0 {
                Text("• \(stats.faceCount) faces")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else if stats.lineCount > 0 {
                Text("• \(stats.lineCount) lines")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Text(stats.formattedDimensions)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .shadow(color: .black.opacity(0.08), radius: 3, y: 1)
    }

    private var bottomControlToolbar: some View {
        HStack(spacing: 10) {
            // Render Mode Picker
            Picker("Mode", selection: $renderMode) {
                ForEach(Model3DRenderMode.allCases) { mode in
                    Label(mode.rawValue, systemImage: mode.iconName).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 240)

            Spacer()

            // Camera View Preset Menu
            Menu {
                ForEach(Model3DCameraPreset.allCases) { preset in
                    Button {
                        cameraPreset = preset
                    } label: {
                        Label(preset.rawValue, systemImage: preset.iconName)
                    }
                }
            } label: {
                Label(cameraPreset.rawValue, systemImage: cameraPreset.iconName)
                    .font(.caption)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
            }
            #if os(macOS)
            .menuStyle(.borderlessButton)
            #endif

            // Toggle Stats HUD Button
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    showStatsHUD.toggle()
                }
            } label: {
                Image(systemName: showStatsHUD ? "info.circle.fill" : "info.circle")
                    .font(.system(size: 15))
                    .padding(8)
                    .background(.regularMaterial, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(showStatsHUD ? "Hide 3D statistics" : "Show 3D statistics")
        }
        .padding(10)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.10), radius: 6, y: 2)
    }

    private func loadScene() {
        isLoading = true
        errorMessage = nil

        let targetURL = sourceURL
        let targetData = sourceData
        let name = fileName

        Task.detached(priority: .userInitiated) {
            do {
                let loaded: Worlds3DSceneLoader.LoadedScene
                if let targetURL {
                    loaded = try Worlds3DSceneLoader.load(from: targetURL)
                } else if let targetData, let format = Worlds3D.format(name: name) {
                    loaded = try Worlds3DSceneLoader.load(data: targetData, format: format)
                } else {
                    let ext = (name as NSString).pathExtension.lowercased()
                    throw Worlds3DError.unsupportedFormat(ext)
                }

                await MainActor.run {
                    self.loadedScene = loaded
                    self.renderMode = loaded.format.defaultRenderMode
                    self.isLoading = false
                }
            } catch {
                await MainActor.run {
                    self.errorMessage = error.localizedDescription
                    self.isLoading = false
                }
            }
        }
    }
}
