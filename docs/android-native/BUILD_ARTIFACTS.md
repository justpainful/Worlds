# Android build artifacts

The current packages are development builds. Their existence does not establish
feature parity, device compatibility, or release readiness.

Build from `Android` with JDK 17, Android SDK/NDK and all four Android Rust
targets installed:

```sh
./gradlew :app:assembleDebug :app:assembleRelease :app:bundleRelease
python3 tools/package_artifacts.py --apksigner "$ANDROID_HOME/build-tools/37.0.0/apksigner"
./gradlew :app:assembleRelease -Pworlds.abiSplits=true
python3 tools/package_artifacts.py --apksigner "$ANDROID_HOME/build-tools/37.0.0/apksigner" --splits-only
```

The validation script checks ZIP integrity, the Yrs library for arm64-v8a,
armeabi-v7a, x86 and x86_64, and signature status. It writes the three packages
four unsigned ABI-specific APKs, and SHA-256 hashes to `Android/build/artifacts`.
Save the universal packages before building the split APKs because Gradle uses
the same output directory for both configurations. The Debug APK is signed with the
standard local Android debug key and can be installed with `adb install -r`.
The Release APK and AAB are unsigned and require appropriate signing before
distribution. The debug key is not suitable for a production release.

The `packages` job in `.github/workflows/android-platforms.yml` builds, verifies,
and uploads these files to the `worlds-android-packages` Actions artifact. A
local workflow definition is not evidence that a GitHub Actions run succeeded.
Screenshot collections, actual device validation, and the
remaining product requirements still need completion.
