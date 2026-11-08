param([string]$Serial = 'emulator-5554')
$ErrorActionPreference = 'Stop'
if ($Serial -notmatch '^emulator-[0-9]+$') { throw 'This test only runs on an explicitly selected Android emulator.' }
$androidRoot = Split-Path -Parent $PSScriptRoot
Push-Location $androidRoot
try {
    & .\gradlew.bat :app:assembleDebug :app:assembleDebugAndroidTest
    if ($LASTEXITCODE -ne 0) { throw 'Android test build failed.' }
    & adb -s $Serial install -r 'app/build/outputs/apk/debug/app-debug.apk'
    if ($LASTEXITCODE -ne 0) { throw 'Could not install the debug app.' }
    & adb -s $Serial install -r 'app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'
    if ($LASTEXITCODE -ne 0) { throw 'Could not install the test app.' }
    $wifi = (& adb -s $Serial shell settings get global wifi_on).Trim()
    $mobile = (& adb -s $Serial shell settings get global mobile_data).Trim()
    if ($wifi -notin @('0','1') -or $mobile -notin @('0','1')) { throw 'Could not determine the original emulator network settings.' }
    function Invoke-NetworkStage([string]$Expected) {
        $output = & adb -s $Serial shell am instrument -w -r -e networkExpected $Expected -e class 'worlds.android.NetworkAvailabilityTest' 'worlds.android.test/androidx.test.runner.AndroidJUnitRunner' 2>&1
        $exitCode = $LASTEXITCODE
        $output | Write-Output
        if ($exitCode -ne 0 -or ($output -join "`n") -notmatch 'OK \(1 test\)') { throw "Network state test failed: $Expected" }
    }
    if ($wifi -eq '1' -or $mobile -eq '1') { Invoke-NetworkStage 'online' }
    try {
        & adb -s $Serial shell svc wifi disable
        if ($LASTEXITCODE -ne 0) { throw 'Could not disable emulator Wi-Fi.' }
        & adb -s $Serial shell svc data disable
        if ($LASTEXITCODE -ne 0) { throw 'Could not disable emulator mobile data.' }
        Start-Sleep -Seconds 5
        Invoke-NetworkStage 'offline'
    } finally {
        if ($wifi -eq '1') { & adb -s $Serial shell svc wifi enable } else { & adb -s $Serial shell svc wifi disable }
        if ($mobile -eq '1') { & adb -s $Serial shell svc data enable } else { & adb -s $Serial shell svc data disable }
    }
} finally { Pop-Location }
