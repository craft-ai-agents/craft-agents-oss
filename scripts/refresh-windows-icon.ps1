<#
.SYNOPSIS
    Refresh Windows' icon cache and rebuild ARCHstudio's Start Menu and
    Desktop shortcuts so the freshly packaged ARCHstudio.exe shows the
    new icon everywhere.

.DESCRIPTION
    electron-builder uses Squirrel.Windows which replaces the EXE in place
    at $env:LOCALAPPDATA\Programs\@craft-agentelectron\ARCHstudio.exe. The
    .lnk shortcuts Squirrel created on first install survive Squirrel
    in-place updates, and the shell icon cache (iconcache_*.db under
    $env:LOCALAPPDATA\Microsoft\Windows\Explorer) is never invalidated.
    The result is that the EXE on disk has the new icon but Explorer / Start
    Menu / Desktop / Taskbar keep showing the previous icon. Reinstalling
    DOES NOT fix it.

    This script:
      1. Locates the installed EXE.
      2. Extracts the EXE's actual icon resource to a PNG as proof.
      3. Stops Explorer.exe so cached icon DB file handles are released.
      4. Deletes iconcache_*.db and ExplorerIconCache*.db.
      5. Removes stale ARCHstudio*.lnk shortcuts in Start Menu / Desktop
         and re-creates them pointing at the installed EXE so they pick up
         the EXE's current embedded icon (Squirrel only creates those
         shortcuts via the installer verbs, NOT on app launch -- so we must
         recreate or lose them).
      6. Restarts Explorer.exe.
      7. Calls ie4uinit.exe -show to force shell icon association refresh.

.PARAMETER SkipShortcuts
    Skip shortcut delete + recreate. Useful if cache is the only problem.

.PARAMETER SkipCacheClear
    Skip cache wipe. Useful for narrowing down which step matters.

.PARAMETER VerifyOnly
    Skip the destructive steps; only extract the icon to a PNG and exit.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\refresh-windows-icon.ps1

    Full fix.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\refresh-windows-icon.ps1 -VerifyOnly

    Show what icon the EXE actually has right now.

.NOTES
    No admin required. ASCII-only source so PowerShell 5.1 parses
    UTF-8-without-BOM cleanly.
#>

[CmdletBinding()]
param(
    [switch]$SkipShortcuts,
    [switch]$SkipCacheClear,
    [switch]$VerifyOnly
)

$ErrorActionPreference = 'Continue'

# ---- output formatting ----------------------------------------------------
if ($Host.UI.SupportsVirtualTerminal) {
    $G = "`e[32m"; $Y = "`e[33m"; $R = "`e[31m"; $C = "`e[36m"; $N = "`e[0m"
} else {
    $G = ''; $Y = ''; $R = ''; $C = ''; $N = ''
}
function Step($m) { Write-Host ($C + '==>' + $N + ' ' + $m) }
function OK($m)   { Write-Host ($G + ' OK ' + $N + ' ' + $m) }
function Warn($m) { Write-Host ($Y + 'WARN' + $N + ' ' + $m) }
function Err($m)  { Write-Host ($R + ' ERR' + $N + ' ' + $m) }

# ---- locate installed EXE ------------------------------------------------
Step 'Locating installed ARCHstudio.exe...'
$candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\@craft-agentelectron\ARCHstudio.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\ARCHstudio\ARCHstudio.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\ARCHstudio.exe'),
    (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'ARCHstudio\ARCHstudio.exe'),
    (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'ARCHstudio\ARCHstudio.exe')
)
$installed = $null
foreach ($p in $candidates) {
    if ($p -and (Test-Path -LiteralPath $p)) {
        $installed = $p
        break
    }
}
if (-not $installed) {
    Err 'Could not find ARCHstudio.exe in any standard install location:'
    foreach ($p in $candidates) { Write-Host ('    ' + $p) }
    exit 1
}
OK ('Found: ' + $installed)

# ---- compute verify-output path ------------------------------------------
$repoRoot = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $repoRoot 'apps\electron\release'
$diagDir = Join-Path $releaseDir 'diag'
$verifyPng = Join-Path $diagDir ('arch-icon-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.png')

# ---- extract current EXE icon --------------------------------------------
Step ('Extracting embedded icon -> ' + $verifyPng)
try {
    if (-not (Test-Path -LiteralPath $diagDir)) { New-Item -ItemType Directory -Path $diagDir -Force | Out-Null }
    Add-Type -AssemblyName System.Drawing
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($installed)
    if ($icon) {
        $icon.ToBitmap().Save($verifyPng, [System.Drawing.Imaging.ImageFormat]::Png)
        $icon.Dispose()
        $size = (Get-Item -LiteralPath $verifyPng).Length
        OK ('Saved: ' + $verifyPng + ' (' + $size + ' bytes)')
    } else {
        Warn 'System.Drawing.Icon returned null -- icon resource may be missing.'
    }
} catch {
    Warn ('Icon extraction failed: ' + $_.Exception.Message)
}

# ---- verify-only short-circuit -------------------------------------------
if ($VerifyOnly) {
    Step 'VerifyOnly set; leaving cache and shortcuts alone.'
    exit 0
}

# ---- stop Explorer --------------------------------------------------------
Step 'Stopping Explorer.exe...'
$explorer = Get-Process -Name explorer -ErrorAction SilentlyContinue
if ($explorer) {
    $explorer | Stop-Process -Force
    Start-Sleep -Milliseconds 600
    OK 'Explorer stopped.'
} else {
    OK 'Explorer was not running.'
}

# ---- wipe icon cache ------------------------------------------------------
if (-not $SkipCacheClear) {
    Step ('Wiping icon cache in ' + $env:LOCALAPPDATA + '\Microsoft\Windows\Explorer...')
    $cacheDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Explorer'
    if (-not (Test-Path -LiteralPath $cacheDir)) {
        Warn ('Cache directory does not exist: ' + $cacheDir)
    } else {
        Get-ChildItem -LiteralPath $cacheDir -File -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like 'iconcache_*.db' -or $_.Name -like 'ExplorerIconCache*.db' } |
            ForEach-Object {
                Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
                if (Test-Path -LiteralPath $_.FullName) {
                    Warn ('Could not delete ' + $_.Name + ' (file in use?).')
                } else {
                    OK ('Deleted: ' + $_.Name)
                }
            }
    }
}

# ---- drop stale .lnk shortcuts and re-create fresh ones ------------------
if (-not $SkipShortcuts) {
    Step 'Removing stale ARCHstudio shortcuts...'
    $shortcutDirs = @(
        [Environment]::GetFolderPath('Programs'),
        [Environment]::GetFolderPath('Desktop'),
        (Join-Path $env:PUBLIC 'Desktop')
    )
    foreach ($dir in $shortcutDirs) {
        Get-ChildItem -LiteralPath $dir -File -Filter 'ARCHstudio*.lnk' -Force -ErrorAction SilentlyContinue |
            ForEach-Object {
                Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
                if (-not (Test-Path -LiteralPath $_.FullName)) {
                    OK ('Removed: ' + $_.FullName)
                }
            }
    }

    Step 'Recreating Start Menu + Desktop shortcuts pointing at EXE...'
    $workDir = Split-Path -Parent $installed
    $shell = New-Object -ComObject WScript.Shell

    try {
        $startMenuShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'ARCHstudio.lnk'
        $sm = $shell.CreateShortcut($startMenuShortcut)
        $sm.TargetPath = $installed
        $sm.WorkingDirectory = $workDir
        $sm.IconLocation = $installed + ',0'
        $sm.WindowStyle = 7
        $sm.Description = 'ARCHstudio'
        $sm.Save()
        OK ('Created: ' + $startMenuShortcut)
    } catch {
        Warn ('Failed to create Start Menu shortcut: ' + $_.Exception.Message)
    }

    try {
        $desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'ARCHstudio.lnk'
        $ds = $shell.CreateShortcut($desktopShortcut)
        $ds.TargetPath = $installed
        $ds.WorkingDirectory = $workDir
        $ds.IconLocation = $installed + ',0'
        $ds.WindowStyle = 7
        $ds.Description = 'ARCHstudio'
        $ds.Save()
        OK ('Created: ' + $desktopShortcut)
    } catch {
        Warn ('Failed to create Desktop shortcut: ' + $_.Exception.Message)
    }

    try {
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
    } catch { }
}

# ---- restart Explorer ----------------------------------------------------
Step 'Starting Explorer.exe...'
try {
    Start-Process -FilePath explorer.exe -ErrorAction Stop
    Start-Sleep -Milliseconds 1000
    if (Get-Process -Name explorer -ErrorAction SilentlyContinue) {
        OK 'Explorer restarted.'
    } else {
        Warn 'Explorer did not come back up automatically. Start it from Task Manager (File -> Run new task -> explorer).'
    }
} catch {
    Err ('Failed to start Explorer: ' + $_.Exception.Message)
}

# ---- invalidate shell icon association ----------------------------------
Step 'Calling ie4uinit.exe -show...'
$ie4uinit = Join-Path $env:WINDIR 'System32\ie4uinit.exe'
if (Test-Path -LiteralPath $ie4uinit) {
    try {
        Start-Process -FilePath $ie4uinit -ArgumentList '-show' -ErrorAction Stop | Out-Null
        OK 'ie4uinit.exe -show dispatched.'
    } catch {
        Warn ('ie4uinit.exe failed: ' + $_.Exception.Message)
    }
} else {
    Warn ('ie4uinit.exe not found at ' + $ie4uinit + ' (this is fine on Server SKUs).')
}

# ---- reminders ------------------------------------------------------------
Step 'Done.'
Write-Host ''
Write-Host 'Next steps:'
Write-Host '  1. Right-click Desktop and Start Menu -> Refresh if needed.'
Write-Host '  2. ARCHstudio taskbar pin: if the old icon persists, right-click'
Write-Host '     the pinned tile -> Unpin. Then find ARCHstudio in the Start'
Write-Host '     Menu, right-click -> Pin to taskbar to re-pin with the new icon.'
Write-Host '  3. If the in-place EXE icon still looks old in File Explorer,'
Write-Host '     right-click Properties -> Details and compare to:'
Write-Host ('     ' + $verifyPng)
Write-Host ''
