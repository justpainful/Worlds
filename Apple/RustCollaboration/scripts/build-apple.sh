#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPLE="$(cd "$ROOT/.." && pwd)"
OUT="$APPLE/WorldsCore/Artifacts/WorldsRustCollaboration.xcframework"
BUILD="$ROOT/target/apple-build"
command -v xcodebuild >/dev/null
command -v xcrun >/dev/null
command -v cargo >/dev/null
for target in aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios aarch64-apple-darwin x86_64-apple-darwin; do
  rustup target list --installed | grep -qx "$target" || { echo "Missing Rust target: $target" >&2; exit 1; }
  cargo build --manifest-path "$ROOT/Cargo.toml" --locked --release --target "$target"
done
mkdir -p "$BUILD/simulator" "$BUILD/macos" "$(dirname "$OUT")"
xcrun lipo -create "$ROOT/target/aarch64-apple-ios-sim/release/libworlds_collaboration.a" "$ROOT/target/x86_64-apple-ios/release/libworlds_collaboration.a" -output "$BUILD/simulator/libworlds_collaboration.a"
xcrun lipo -create "$ROOT/target/aarch64-apple-darwin/release/libworlds_collaboration.a" "$ROOT/target/x86_64-apple-darwin/release/libworlds_collaboration.a" -output "$BUILD/macos/libworlds_collaboration.a"
# xcodebuild requires a nonexistent output destination. The output is a generated artifact.
if [ -e "$OUT" ]; then echo "Output already exists: $OUT; move it aside before rebuilding" >&2; exit 1; fi
xcodebuild -create-xcframework \
  -library "$ROOT/target/aarch64-apple-ios/release/libworlds_collaboration.a" -headers "$ROOT/include" \
  -library "$BUILD/simulator/libworlds_collaboration.a" -headers "$ROOT/include" \
  -library "$BUILD/macos/libworlds_collaboration.a" -headers "$ROOT/include" \
  -output "$OUT"
