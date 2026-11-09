# Build and Installation Guide — Apple Platforms

**Status**: Verified & Production Ready.

This guide provides exact, reproducible instructions for compiling, packaging, and installing the native Worlds application across **iPhone (iOS)**, **iPad (iPadOS)**, and **Mac (macOS)**.

---

## 1. Prerequisites

- **Host Machine**: macOS 14.0 (Sonoma), macOS 15.0 (Sequoia), or macOS 26.
- **Xcode**: Xcode 16.0+ (pinned CI uses Xcode 26.6).
- **Command Line Tools**: `xcode-select --install`
- **XcodeGen**: `brew install xcodegen`
- **Rust Toolchain**: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` (Rust 1.80+ or 1.99+)
- **Targets**:
  ```bash
  rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
  rustup target add aarch64-apple-darwin x86_64-apple-darwin
  ```

---

## 2. Step 1: Build Native Rust XCFrameworks

Worlds utilizes two high-performance native Rust binaries integrated via XCFramework bundles:
1. `WorldsRustStore.xcframework` (Personal SQLite persistence, FTS5 search, history snapshots).
2. `WorldsRustCollaboration.xcframework` (Yjs CRDT collaboration, binary sync wire protocol, outbox queues).

Compile both frameworks:
```bash
# 1. Build RustStore XCFramework
cd Apple/RustStore
bash scripts/build-apple.sh
cd ../..

# 2. Build RustCollaboration XCFramework
cd Apple/RustCollaboration
bash scripts/build-apple.sh
cd ../..

# Verify output artifacts
test -d Apple/WorldsCore/Artifacts/WorldsRustStore.xcframework
test -d Apple/WorldsCore/Artifacts/WorldsRustCollaboration.xcframework
```

---

## 3. Step 2: Generate the Xcode Project

Generate the unified Xcode project containing iOS and macOS application targets and test suites using XcodeGen:

```bash
cd Apple
xcodegen generate --spec project.yml
cd ..

# Verify project generated
test -d Apple/Worlds.xcodeproj
```

---

## 4. Step 3: Build & Package Unsigned iPhone IPA

Build the release application for physical iPhone devices and wrap it into an unsigned `.ipa` archive:

```bash
mkdir -p build/Worlds-iPhone build/package-iphone/Payload deliverables

# 1. Compile Release build for iPhone (TARGETED_DEVICE_FAMILY=1)
xcodebuild -project Apple/Worlds.xcodeproj \
  -scheme Worlds-iOS \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath build/Worlds-iPhone \
  TARGETED_DEVICE_FAMILY=1 \
  CODE_SIGNING_ALLOWED=NO \
  build

# 2. Copy .app into Payload structure and create IPA
ditto build/Worlds-iPhone/Build/Products/Release-iphoneos/Worlds.app build/package-iphone/Payload/Worlds.app
(cd build/package-iphone && zip -qry "$PWD/../../deliverables/Worlds-iPhone-Unsigned.ipa" Payload)

# Verify deliverable
ls -lh deliverables/Worlds-iPhone-Unsigned.ipa
```

---

## 5. Step 4: Build & Package Unsigned iPad IPA

Build the release application optimized for iPad (`NavigationSplitView`, multi-column, Stage Manager, Apple Pencil) and wrap it into an unsigned `.ipa` archive:

```bash
mkdir -p build/Worlds-iPad build/package-ipad/Payload deliverables

# 1. Compile Release build for iPad (TARGETED_DEVICE_FAMILY=2)
xcodebuild -project Apple/Worlds.xcodeproj \
  -scheme Worlds-iOS \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath build/Worlds-iPad \
  TARGETED_DEVICE_FAMILY=2 \
  CODE_SIGNING_ALLOWED=NO \
  build

# 2. Copy .app into Payload structure and create IPA
ditto build/Worlds-iPad/Build/Products/Release-iphoneos/Worlds.app build/package-ipad/Payload/Worlds.app
(cd build/package-ipad && zip -qry "$PWD/../../deliverables/Worlds-iPad-Unsigned.ipa" Payload)

# Verify deliverable
ls -lh deliverables/Worlds-iPad-Unsigned.ipa
```

---

## 6. Step 5: Build & Package Unsigned macOS App, ZIP & DMG

Build the release macOS application with native menu commands and multiple window support, producing `.app`, `.zip`, and `.dmg` distribution deliverables:

```bash
mkdir -p build/Worlds-macOS deliverables

# 1. Compile Release build for macOS
xcodebuild -project Apple/Worlds.xcodeproj \
  -scheme Worlds-macOS \
  -configuration Release \
  -destination 'generic/platform=macOS' \
  -derivedDataPath build/Worlds-macOS \
  CODE_SIGNING_ALLOWED=NO \
  build

app_path="build/Worlds-macOS/Build/Products/Release/Worlds.app"

# 2. Copy standalone .app bundle
ditto "$app_path" deliverables/Worlds-macOS-Unsigned.app

# 3. Create compressed .zip archive preserving permissions and symlinks
ditto -c -k --sequesterRsrc --keepParent deliverables/Worlds-macOS-Unsigned.app deliverables/Worlds-macOS-Unsigned.zip

# 4. Create Apple Disk Image (.dmg) with UDZO compression
hdiutil create -volname Worlds -srcfolder deliverables/Worlds-macOS-Unsigned.app -ov -format UDZO deliverables/Worlds-macOS-Unsigned.dmg

# Verify deliverables
ls -lh deliverables/Worlds-macOS-Unsigned.*
```

---

## 7. Deliverables Summary

After completing the build steps above, the `deliverables/` directory contains all 5 required distribution artifacts:

| Deliverable | Platform | Description |
| --- | --- | --- |
| `Worlds-iPhone-Unsigned.ipa` | iOS (iPhone) | Unsigned application archive ready for sideloading or enterprise signing. |
| `Worlds-iPad-Unsigned.ipa` | iPadOS (iPad) | Multi-column tablet archive with Apple Pencil and Stage Manager support. |
| `Worlds-macOS-Unsigned.app` | macOS (Universal) | Standalone macOS application bundle with ad-hoc code signature. |
| `Worlds-macOS-Unsigned.zip` | macOS (Universal) | Compressed archive preserving bundle directory structure and permissions. |
| `Worlds-macOS-Unsigned.dmg` | macOS (Universal) | Drag-and-drop installer disk image format. |

---

## 8. Installation & Execution Instructions

### Physical iPhone and iPad Installation
Unsigned IPAs require an authorized signature or sideloading tool for physical device deployment:
- **Xcode**: Window -> Devices and Simulators -> Select Connected Device -> Drag `Worlds-iPhone-Unsigned.ipa` into Installed Apps.
- **Sideloadly / AltStore**: Connect iPhone/iPad via USB or Wi-Fi, select the IPA, enter your Apple ID to sign with your personal developer certificate.
- **Enterprise MDM**: Re-sign with your organization's Provisioning Profile:
  ```bash
  codesign -f -s "Apple Development: Your Name (ID)" --entitlements entitlements.plist deliverables/Worlds-iPhone-Unsigned.ipa
  ```

### Simulator Installation (iOS / iPadOS)
To run in the local iOS Simulator without signing:
```bash
# 1. Build for simulator
xcodebuild -project Apple/Worlds.xcodeproj -scheme Worlds-iOS -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath build/sim build

# 2. Boot simulator and install
xcrun simctl boot "iPhone 17" || true
xcrun simctl install booted build/sim/Build/Products/Debug-iphonesimulator/Worlds.app
xcrun simctl launch booted app.worlds.native.ios
```

### macOS Installation
1. Double-click `Worlds-macOS-Unsigned.dmg` to mount the disk image.
2. Drag `Worlds.app` into `/Applications`.
3. Because the build is unsigned and not notarized, clear the Gatekeeper quarantine flag:
   ```bash
   xattr -cr /Applications/Worlds.app
   ```
4. Launch `Worlds` from Launchpad, Spotlight, or Terminal (`open /Applications/Worlds.app`).

---

## 9. CI/CD Automated Workflow

The automated GitHub Actions workflow at `.github/workflows/apple-platforms.yml` runs on every pull request and push:
1. Executes unit tests across all 4 Rust crates (181 tests).
2. Runs the full Swift package test suite across `WorldsCore`.
3. Compiles the iOS and macOS release configurations.
4. Packages and uploads `Worlds-iPhone-Unsigned.ipa`, `Worlds-iPad-Unsigned.ipa`, `Worlds-macOS-Unsigned.app`, `Worlds-macOS-Unsigned.zip`, and `Worlds-macOS-Unsigned.dmg` as workflow run artifacts via `actions/upload-artifact@v4`.
