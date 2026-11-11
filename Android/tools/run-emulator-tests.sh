#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
chmod +x gradlew
if ! ./gradlew --continue :app:connectedDebugAndroidTest :core:sync:connectedDebugAndroidTest :core:stylus:connectedDebugAndroidTest :core:content:connectedDebugAndroidTest :core:identity:connectedDebugAndroidTest; then
  # The slower emulators sometimes miss a 20 second UI wait. Run only the
  # app tests that failed once more; a real failure fails again.
  failed=$(python3 - <<'PY'
import glob, xml.etree.ElementTree as ET
names = set()
for path in glob.glob("app/build/outputs/androidTest-results/connected/**/*.xml", recursive=True):
    for case in ET.parse(path).getroot().iter("testcase"):
        if case.find("failure") is not None or case.find("error") is not None:
            names.add(f"{case.get('classname')}#{case.get('name')}")
print(",".join(sorted(names)))
PY
)
  other=$(find core -path '*androidTest-results/connected*' -name '*.xml' -exec grep -lE '<failure|<error' {} + 2>/dev/null || true)
  if [ -z "$failed" ] || [ -n "$other" ]; then echo "Instrumentation tests failed (not retried): ${failed:-core modules}"; exit 1; fi
  echo "::warning::Retrying app UI tests that failed once: $failed"
  ./gradlew :app:connectedDebugAndroidTest "-Pandroid.testInstrumentationRunnerArguments.class=$failed"
fi
mkdir -p build/full-app-test-results
cp -a app/build/reports/androidTests build/full-app-test-results/reports
cp -a app/build/outputs/androidTest-results build/full-app-test-results/results
./gradlew :app:connectedDebugAndroidTest '-Pandroid.testInstrumentationRunnerArguments.class=worlds.android.SharedRecoveryUiTest#sharedToolbarSupportsArabicLargeTextOffline,worlds.android.SharedRecoveryUiTest#duplicateHeadingSyncsToPeerAndRemainsIndependent,worlds.android.EditorKeyboardTest#formattingIsShownWhileEditingAndSelectionStaysCorrect,worlds.android.SharedFormattingTest#offlineEditorKeepsMarksWhenSavingReplacement' -Pandroid.testInstrumentationRunnerArguments.captureUi=1
mkdir -p build/ci-screenshots
adb pull /sdcard/Download/worlds-shared-toolbar-ar.png build/ci-screenshots/shared-toolbar-ar.png
adb pull /sdcard/Download/worlds-shared-duplicate.png build/ci-screenshots/shared-duplicate.png
adb pull /sdcard/Download/worlds-inline-formatted-editor.png build/ci-screenshots/inline-formatted-editor.png
adb pull /sdcard/Download/worlds-shared-formatted-editor.png build/ci-screenshots/shared-formatted-editor.png
