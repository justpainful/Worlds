# Installs (or updates) Worlds from the latest release build.
#   pnpm app:install   builds the installer, then runs this script
# Data is not touched: it lives in %APPDATA%\Worlds for every build.
$ErrorActionPreference = 'Stop'

# Cargo's target directory may be redirected (for example by a local
# .cargo/config.toml), so ask cargo where it is.
$meta = cargo metadata --format-version 1 --no-deps --manifest-path (Join-Path $PSScriptRoot '..\src-tauri\Cargo.toml') | ConvertFrom-Json
$bundle = Join-Path $meta.target_directory 'release\bundle\nsis'
$installer = Get-ChildItem $bundle -Filter 'Worlds_*_x64-setup.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) { throw "No installer found in $bundle. Run: pnpm tauri build" }

# A running copy would keep the old files locked (and the single-instance
# guard would just focus it), so close it first. Edits autosave instantly.
$running = Get-Process worlds -ErrorAction SilentlyContinue
if ($running) { $running | Stop-Process -Force; Start-Sleep -Milliseconds 800 }

Write-Host "Installing $($installer.Name)"
$p = Start-Process $installer.FullName -ArgumentList '/S' -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Installer exited with code $($p.ExitCode)" }

$exe = Join-Path $env:LOCALAPPDATA 'Worlds\worlds.exe'
if (-not (Test-Path $exe)) { throw "Worlds was not found at $exe after installing" }

# Desktop shortcut (the installer already adds the Start menu entry).
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'Worlds.lnk'
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = $exe
$s.WorkingDirectory = Split-Path $exe
$s.IconLocation = "$exe,0"
$s.Description = 'Worlds'
$s.Save()

# Keep the Claude Code tool registration pointing at the installed app.
if (Get-Command claude -ErrorAction SilentlyContinue) {
  $reg = (claude mcp get worlds 2>$null) -join "`n"
  if ($reg -and $reg -notmatch [regex]::Escape($exe)) {
    claude mcp remove --scope user worlds *> $null
    claude mcp add --scope user worlds -- $exe --mcp --actor ai *> $null
    Write-Host 'Updated the Claude Code tool registration'
  }
}

Start-Process $exe
Write-Host "Installed: $exe"
