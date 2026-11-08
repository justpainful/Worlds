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
    function Invoke-Stage([string]$Method) {
        $className = "worlds.android.OfflineProcessRestartTest#$Method"
        $output = & adb -s $Serial shell am instrument -w -r -e processRestart 1 -e class $className 'worlds.android.test/androidx.test.runner.AndroidJUnitRunner' 2>&1
        $exitCode = $LASTEXITCODE
        $output | Write-Output
        if ($exitCode -ne 0 -or ($output -join "`n") -notmatch 'OK \(1 test\)') { throw "Process restart stage failed: $Method" }
    }
    function Stop-TestProcess {
        & adb -s $Serial shell am force-stop worlds.android
        if ($LASTEXITCODE -ne 0) { throw 'Could not stop the test app on the emulator.' }
        $pidValue = & adb -s $Serial shell pidof worlds.android
        if ($pidValue) { throw 'The test app process is still running.' }
    }
    Invoke-Stage 'seedInFirstProcess'
    Stop-TestProcess
    Invoke-Stage 'editOfflineInSecondProcess'
    Stop-TestProcess
    Invoke-Stage 'reconnectInThirdProcess'
} finally { Pop-Location }
