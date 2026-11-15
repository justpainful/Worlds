# Signing Android releases

Android installs a new version of an app over the old one only when both are signed with the same key. Until now the published APK was the debug build, signed with the debug key that each GitHub runner generates for itself, so every release had a different key: a phone with one version could not update to the next without uninstalling, and uninstalling deletes the pages on the phone (the app does not use Android backup).

Release builds are now signed with one Worlds release key when it is in the repository's secrets. Without the secrets nothing changes: release builds stay unsigned and the release keeps publishing the debug build.

## What CI does

- `.github/workflows/android-platforms.yml`, job `packages`: when `WORLDS_ANDROID_KEYSTORE_BASE64` is set, it writes the keystore to the runner's temporary folder and Gradle signs `:app:assembleRelease` and `:app:bundleRelease` with it (`Android/app/build.gradle.kts`).
- `Android/tools/package_artifacts.py` then collects `Worlds-Android-Universal.apk`, `Worlds-Android-Release.aab` and the per-ABI APKs, and fails unless `apksigner` verifies each APK and the bundle carries a signature.
- `.github/workflows/publish-release.yml` publishes `Worlds-Android-Universal.apk` as `Worlds-<version>-Android-Universal.apk`, and falls back to the debug build only when there is no signed one.

The keystore never enters the repository, the logs or the artifacts.

## Creating the key (once, by the owner)

1. Make the keystore with the JDK's `keytool`. Choose a strong password and keep it with the file.

   ```
   keytool -genkeypair -v -keystore worlds-release.jks -alias worlds -keyalg RSA -keysize 4096 -validity 10000
   ```

2. Keep `worlds-release.jks` and its passwords somewhere safe and backed up, outside the repository. If the key is lost, no later version can update an installed Worlds; if it leaks, someone else can sign an app that installs over it.

3. Add four repository secrets (GitHub, Settings, Secrets and variables, Actions, New repository secret), or with the GitHub CLI from the folder that holds the file:

   | Secret | Value |
   | --- | --- |
   | `WORLDS_ANDROID_KEYSTORE_BASE64` | the keystore file in base64 |
   | `WORLDS_ANDROID_KEYSTORE_PASSWORD` | the keystore password |
   | `WORLDS_ANDROID_KEY_ALIAS` | `worlds` (the alias used above) |
   | `WORLDS_ANDROID_KEY_PASSWORD` | the key password (the same as the keystore password unless you chose another) |

   In PowerShell, the base64 secret can be set without the value passing through the clipboard or the screen:

   ```
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("worlds-release.jks")) | gh secret set WORLDS_ANDROID_KEYSTORE_BASE64 -R justpainful/Worlds
   gh secret set WORLDS_ANDROID_KEYSTORE_PASSWORD -R justpainful/Worlds
   gh secret set WORLDS_ANDROID_KEY_ALIAS -R justpainful/Worlds --body worlds
   gh secret set WORLDS_ANDROID_KEY_PASSWORD -R justpainful/Worlds
   ```

   `gh secret set` without `--body` asks for the value without showing it.

4. The next run of the `Android core checks` workflow says "Release builds are signed with the Worlds release key." and its `worlds-android-packages` artifact holds `Worlds-Android-Universal.apk`.

## The first signed release

Versions up to 0.3.0 were signed with a runner's debug key, so the first release signed with the Worlds key cannot install over them: people uninstall the old version once, then install the new one. From then on every version installs over the last. The install guide on enterworlds.space (`web/content/{ar,en}/docs/install/android.html`) should say this for that release, and stop warning about updates after it.
