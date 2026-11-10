# Building and Installing Worlds for Android and ChromeOS

This guide covers building, testing, packaging, and installing Worlds Native for Android (phones, tablets, foldables) and ChromeOS (Chromebooks, Chromeboxes).

---

## 1. System Prerequisites

- **Operating System**: Linux (Ubuntu 22.04+), macOS (13+), or Windows 11 with PowerShell 7+.
- **Java Development Kit**: JDK 17 (Eclipse Temurin 17 recommended). Set `JAVA_HOME`.
- **Android SDK**:
  - `compileSdk`: 37
  - `minSdk`: 26 (Android 8.0 Oreo)
  - `targetSdk`: 36 (Android 15)
  - `build-tools`: 35.0.0+
  - Android NDK: `28.2.13676358`
- **Rust Toolchain**: Rust 1.80+ with target triples for cross-compiling native Yrs:
  ```bash
  rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android
  ```

---

## 2. Project Architecture & Gradle Modules

Worlds is structured into five modular Gradle projects:
- `:app` — Main Jetpack Compose application, UI components, AI Chat, Automations, Discord, Drawing UI, Settings, and Print/PDF integration.
- `:core:content` — SQLite persistence, content schema, block editing, and automations execution engine.
- `:core:identity` — Account authentication, encrypted keystore session tokens, workspace memberships, and invitations.
- `:core:stylus` — Low-latency drawing engine (`WorldsStylusEngine`), S Pen and USI 2.0 pointer routing, palm rejection, and geometry processing.
- `:core:sync` — Collaborative sync engine, network protocol, durable outbox, and JNI bindings to the native Yrs Rust library.

---

## 3. Building Binaries

All build tasks run from the `Android/` root directory.

### Debug APK
Builds an installable debug APK signed with the default debug keystore:
```bash
./gradlew :app:assembleDebug
```
Output artifact:
```
Android/app/build/outputs/apk/debug/app-debug.apk
```

### ABI Split APKs
To generate optimized, architecture-specific APKs:
```bash
./gradlew :app:assembleDebug -Pworlds.abiSplits=true
```
Outputs:
```
Android/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
Android/app/build/outputs/apk/debug/app-armeabi-v7a-debug.apk
Android/app/build/outputs/apk/debug/app-x86_64-debug.apk
Android/app/build/outputs/apk/debug/app-x86-debug.apk
```

### Unsigned Release Bundle (AAB) & Release APK
```bash
./gradlew :app:bundleRelease :app:assembleRelease
```
Outputs:
```
Android/app/build/outputs/bundle/release/app-release.aab
Android/app/build/outputs/apk/release/app-release-unsigned.apk
```

---

## 4. Verification and Test Suites

Run all unit tests across all native and Kotlin modules:
```bash
./gradlew :app:testDebugUnitTest :core:stylus:testDebugUnitTest :core:sync:testDebugUnitTest
```

Run native Rust Yrs engine tests:
```bash
cargo test --locked --manifest-path core/sync/native/Cargo.toml
```

Run Android Lint static analysis:
```bash
./gradlew :app:lintDebug :core:sync:lintDebug :core:stylus:lintDebug
```

---

## 5. Installing on Devices

### Android Phone / Tablet / Foldable via ADB
1. Enable **Developer Options** and **USB Debugging** on your device.
2. Connect your device via USB or Wi-Fi (`adb connect <ip>:<port>`).
3. Verify connection:
   ```bash
   adb devices
   ```
4. Install the debug APK:
   ```bash
   adb install -r Android/app/build/outputs/apk/debug/app-debug.apk
   ```

### ChromeOS Installation
Chromebooks run Android applications via ARC (Android Runtime on Chrome):
1. On your Chromebook, open **Settings** > **Advanced** > **Developers** > **Linux development environment**.
2. Enable **ADB Debugging** under **Develop Android apps**.
3. In the ChromeOS Linux terminal (or via host ADB):
   ```bash
   adb connect arc
   adb install -r app-debug.apk
   ```
4. The Worlds application icon appears in the ChromeOS App Launcher and shelf with full multi-window resizing, USI pen, and keyboard shortcut support.
