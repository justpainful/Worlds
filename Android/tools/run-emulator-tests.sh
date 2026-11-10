#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
chmod +x gradlew
./gradlew :app:connectedDebugAndroidTest :core:sync:connectedDebugAndroidTest :core:stylus:connectedDebugAndroidTest :core:content:connectedDebugAndroidTest :core:identity:connectedDebugAndroidTest
mkdir -p build/full-app-test-results
cp -a app/build/reports/androidTests build/full-app-test-results/reports
cp -a app/build/outputs/androidTest-results build/full-app-test-results/results
./gradlew :app:connectedDebugAndroidTest '-Pandroid.testInstrumentationRunnerArguments.class=worlds.android.SharedRecoveryUiTest#sharedToolbarSupportsArabicLargeTextOffline,worlds.android.SharedRecoveryUiTest#duplicateHeadingSyncsToPeerAndRemainsIndependent,worlds.android.EditorKeyboardTest#formattingIsShownWhileEditingAndSelectionStaysCorrect,worlds.android.SharedFormattingTest#offlineEditorKeepsMarksWhenSavingReplacement' -Pandroid.testInstrumentationRunnerArguments.captureUi=1
mkdir -p build/ci-screenshots
adb pull /sdcard/Download/worlds-shared-toolbar-ar.png build/ci-screenshots/shared-toolbar-ar.png
adb pull /sdcard/Download/worlds-shared-duplicate.png build/ci-screenshots/shared-duplicate.png
adb pull /sdcard/Download/worlds-inline-formatted-editor.png build/ci-screenshots/inline-formatted-editor.png
adb pull /sdcard/Download/worlds-shared-formatted-editor.png build/ci-screenshots/shared-formatted-editor.png
