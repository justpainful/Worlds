param(
    [string]$DesktopRoot = (Split-Path $PSScriptRoot -Parent),
    [string]$AndroidJar = (Join-Path $env:ANDROID_HOME 'platforms\android-37.0\android.jar')
)
$ErrorActionPreference = 'Stop'
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('worlds-core-checks-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
$sync = Join-Path $PSScriptRoot 'core/sync/src'
$stylus = Join-Path $PSScriptRoot 'core/stylus/src'
node (Join-Path $sync 'test/generate-lib0-fixtures.cjs') $DesktopRoot (Join-Path $scratch 'fixtures.txt')
if ($LASTEXITCODE -ne 0) { throw 'Could not generate lib0 fixtures' }
kotlinc (Join-Path $sync 'main/kotlin/worlds/sync/SyncWire.kt') (Join-Path $sync 'test/kotlin/worlds/sync/SyncWireInteropTest.kt') -include-runtime -d (Join-Path $scratch 'sync.jar')
if ($LASTEXITCODE -ne 0) { throw 'Sync compilation failed' }
java -jar (Join-Path $scratch 'sync.jar') (Join-Path $scratch 'fixtures.txt')
if ($LASTEXITCODE -ne 0) { throw 'Sync tests failed' }
kotlinc (Join-Path $stylus 'main/kotlin/worlds/stylus/WorldsStylusEngine.kt') (Join-Path $stylus 'test/kotlin/worlds/stylus/StylusEngineTest.kt') -include-runtime -d (Join-Path $scratch 'stylus.jar')
if ($LASTEXITCODE -ne 0) { throw 'Stylus test compilation failed' }
java -jar (Join-Path $scratch 'stylus.jar')
if ($LASTEXITCODE -ne 0) { throw 'Stylus tests failed' }
if (-not (Test-Path -LiteralPath $AndroidJar)) { throw "Android SDK jar missing: $AndroidJar" }
kotlinc (Join-Path $stylus 'main/kotlin/worlds/stylus/WorldsStylusEngine.kt') (Join-Path $stylus 'main/kotlin/worlds/stylus/AndroidStylusInput.kt') -classpath $AndroidJar -d (Join-Path $scratch 'stylus-android.jar')
if ($LASTEXITCODE -ne 0) { throw 'Android adapter compilation failed' }
Write-Host 'Core checks passed. This does not execute Android instrumentation or hardware tests.'
