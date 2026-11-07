#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
store_dir="$(cd "$script_dir/.." && pwd)"
package_dir="$(cd "$store_dir/../WorldsCore" && pwd)"
build_dir="$store_dir/target/apple-xcframework"
out_dir="$package_dir/Artifacts/WorldsRustStore.xcframework"

command -v xcodebuild >/dev/null
command -v rustup >/dev/null
command -v lipo >/dev/null
for target in aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios aarch64-apple-darwin x86_64-apple-darwin; do
  rustup target add "$target"
  IPHONEOS_DEPLOYMENT_TARGET=17.0 MACOSX_DEPLOYMENT_TARGET=14.0 cargo build --locked --release --manifest-path "$store_dir/Cargo.toml" --target "$target"
done

mkdir -p "$build_dir/simulator" "$build_dir/macos" "$build_dir/headers" "$package_dir/Artifacts"
cp "$store_dir/include/worlds_personal_store.h" "$build_dir/headers/"
cat > "$build_dir/headers/module.modulemap" <<'MODULE'
module WorldsRustStore {
    header "worlds_personal_store.h"
    export *
}
MODULE
lipo -create "$store_dir/target/aarch64-apple-ios-sim/release/libworlds_personal_store.a" "$store_dir/target/x86_64-apple-ios/release/libworlds_personal_store.a" -output "$build_dir/simulator/libworlds_personal_store.a"
lipo -create "$store_dir/target/aarch64-apple-darwin/release/libworlds_personal_store.a" "$store_dir/target/x86_64-apple-darwin/release/libworlds_personal_store.a" -output "$build_dir/macos/libworlds_personal_store.a"
rm -rf "$out_dir"
xcodebuild -create-xcframework \
  -library "$store_dir/target/aarch64-apple-ios/release/libworlds_personal_store.a" -headers "$build_dir/headers" \
  -library "$build_dir/simulator/libworlds_personal_store.a" -headers "$build_dir/headers" \
  -library "$build_dir/macos/libworlds_personal_store.a" -headers "$build_dir/headers" \
  -output "$out_dir"
printf 'Created %s\n' "$out_dir"
