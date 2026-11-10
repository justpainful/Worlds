"""Validate and collect Android builds for CI and local testing."""
import argparse
import hashlib
import shutil
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ABIS = {"arm64-v8a", "armeabi-v7a", "x86", "x86_64"}
FILES = {
    "Worlds-Android-Universal-Debug.apk": ROOT / "app/build/outputs/apk/debug/app-debug.apk",
    "Worlds-Android-Universal-Unsigned.apk": ROOT / "app/build/outputs/apk/release/app-release-unsigned.apk",
    "Worlds-Android-Release-Unsigned.aab": ROOT / "app/build/outputs/bundle/release/app-release.aab",
}
SPLITS = {
    f"Worlds-Android-{abi}-Unsigned.apk": ROOT / f"app/build/outputs/apk/release/app-{abi}-release-unsigned.apk"
    for abi in sorted(ABIS)
}


def inspect_archive(path, bundle, expected_abis):
    with zipfile.ZipFile(path) as archive:
        bad = archive.testzip()
        if bad:
            raise ValueError(f"{path}: corrupt entry {bad}")
        names = archive.namelist()
        prefix = "base/lib/" if bundle else "lib/"
        found = {name.split("/")[2 if bundle else 1] for name in names
                 if name.startswith(prefix) and name.endswith("/libworlds_sync_native.so")}
        if found != expected_abis:
            raise ValueError(f"{path}: expected ABIs {sorted(expected_abis)}, found {sorted(found)}")
        if not any(name.endswith("AndroidManifest.xml") for name in names):
            raise ValueError(f"{path}: missing Android manifest")
        signatures = [name for name in names if name.upper().startswith("META-INF/")
                      and name.upper().endswith((".RSA", ".DSA", ".EC"))]
        return signatures


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apksigner", required=True, help="Path to Android SDK apksigner")
    parser.add_argument("--output", type=Path, default=ROOT / "build/artifacts")
    parser.add_argument("--splits-only", action="store_true", help="Collect ABI APKs after saving the universal packages")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    checksums = []
    packages = ({name: args.output / name for name in FILES} | SPLITS) if args.splits_only else FILES
    for name, source in packages.items():
        if not source.is_file():
            raise FileNotFoundError(source)
        split_abi = next((abi for abi in ABIS if name == f"Worlds-Android-{abi}-Unsigned.apk"), None)
        expected_abis = {split_abi} if split_abi else ABIS
        signatures = inspect_archive(source, name.endswith(".aab"), expected_abis)
        if "Unsigned" in name and signatures:
            raise ValueError(f"{source}: unexpected JAR signature")
        if name.endswith(".apk"):
            result = subprocess.run([args.apksigner, "verify", "--verbose", str(source)],
                                    capture_output=True, text=True)
            output = result.stdout + result.stderr
            if "Debug" in name and result.returncode != 0:
                raise ValueError(f"Debug APK signature verification failed: {output}")
            if "Unsigned" in name and (result.returncode == 0 or "DOES NOT VERIFY" not in output):
                raise ValueError(f"Release APK is signed or could not be verified: {output}")
        destination = args.output / name
        if source.resolve() != destination.resolve():
            shutil.copyfile(source, destination)
        digest = hashlib.sha256(destination.read_bytes()).hexdigest()
        checksums.append(f"{digest}  {name}")
        print(f"Validated {name}: {destination.stat().st_size} bytes, ABIs: {', '.join(sorted(expected_abis))}")
    if not args.splits_only:
        for name in SPLITS:
            (args.output / name).unlink(missing_ok=True)
    (args.output / "SHA256SUMS.txt").write_text("\n".join(checksums) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
