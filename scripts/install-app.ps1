# ARCHstudio Windows Installer
# Usage: $env:ARCHSTUDIO_VERSIONS_URL="<your-release-host>"; ./install-app.ps1

& {
$ErrorActionPreference = "Stop"

# Binary host. Upstream published to https://agents.craft.do/electron; this
# fork has no release host yet, so the download is disabled by default to avoid
# pulling upstream's binaries. Set ARCHSTUDIO_VERSIONS_URL to your own
# electron-builder "generic" host (serving latest/<yml> + installers) to enable.
$VERSIONS_URL = $env:ARCHSTUDIO_VERSIONS_URL
if (-not $VERSIONS_URL) {
    Write-Host "x No binary host configured for this fork." -ForegroundColor Red
    Write-Host "  Set ARCHSTUDIO_VERSIONS_URL to your release host, or build from source (see README.md)."
    return
}
$DOWNLOAD_DIR = "$env:TEMP\archstudio-install"
$APP_NAME = "ARCHstudio"
$CLI_NAME = "archstudio"

# Old brand identifiers, kept only so an existing pre-rebrand install can be
# detected and cleaned up. Do not use these for anything the installer writes.
$LEGACY_APP_NAMES = @("Craft Agents", "Craft Agent")  # brand-leak-allow: detects pre-rebrand install
$LEGACY_INSTALL_DIRS = @(
    "$env:LOCALAPPDATA\Programs\Craft Agents",  # brand-leak-allow
    "$env:LOCALAPPDATA\Programs\@craft-agentelectron"
)
$LEGACY_BIN_DIR = "$env:LOCALAPPDATA\Craft Agents\bin"  # brand-leak-allow

# Colors for output
function Write-Info { Write-Host "> $args" -ForegroundColor Blue }
function Write-Success { Write-Host "> $args" -ForegroundColor Green }
function Write-Warn { Write-Host "! $args" -ForegroundColor Yellow }
function Write-Err { Write-Host "x $args" -ForegroundColor Red; exit 1 }

# Check for Windows
if ($env:OS -ne "Windows_NT") {
    Write-Err "This installer is for Windows only."
}

# Detect architecture
$arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
$platform = "win32-$arch"

Write-Host ""
Write-Info "Detected platform: $platform (arch: $arch)"

# Create download directory
New-Item -ItemType Directory -Force -Path $DOWNLOAD_DIR | Out-Null

# Fetch YAML manifest directly from /electron/latest/ (no version endpoint needed)
Write-Info "Fetching release info..."
$yamlPath = Join-Path $DOWNLOAD_DIR "latest.yml"
try {
    Invoke-WebRequest -Uri "$VERSIONS_URL/latest/latest.yml" -OutFile $yamlPath -UseBasicParsing
} catch {
    Write-Err "Failed to fetch release info: $_"
}

$yamlContent = Get-Content $yamlPath -Raw
if (-not $yamlContent) {
    Write-Err "Failed to fetch release info from latest.yml"
}

# Extract version from YAML manifest
$version = $null
if ($yamlContent -match '(?m)^version:\s*(.+)') {
    $version = $Matches[1].Trim()
}

if (-not $version) {
    Write-Err "Failed to extract version from manifest"
}

Write-Info "Latest version: $version"

# Parse YAML to extract sha512, url (filename), and size for our architecture
# YAML format:
#   files:
#     - url: ARCHstudio-x64.exe
#       sha512: <base64>
#       size: 123456789
#       arch: x64
function Get-YamlEntryForArch {
    param([string]$yaml, [string]$targetArch)
    $lines = $yaml -split "`n"
    $currentUrl = $null
    $currentSha512 = $null
    $currentSize = $null

    foreach ($line in $lines) {
        if ($line -match '^\s*-\s*url:\s*(.+)') {
            $currentUrl = $Matches[1].Trim()
            $currentSha512 = $null
            $currentSize = $null
        }
        if ($line -match '^\s*sha512:\s*(.+)') {
            $currentSha512 = $Matches[1].Trim()
        }
        if ($line -match '^\s*size:\s*(\d+)') {
            $currentSize = [long]$Matches[1]
        }
        if ($line -match '^\s*arch:\s*(.+)') {
            $entryArch = $Matches[1].Trim()
            if ($entryArch -eq $targetArch -and $currentSha512 -and $currentUrl) {
                return @{ url = $currentUrl; sha512 = $currentSha512; size = $currentSize }
            }
        }
    }
    return $null
}

$entry = Get-YamlEntryForArch -yaml $yamlContent -targetArch $arch

if (-not $entry) {
    Write-Err "Architecture $arch not found in latest.yml"
}

$checksum = $entry.sha512
$filename = $entry.url
$fileSize = $entry.size

# Validate checksum format (SHA-512 base64 = 88 characters)
if (-not $checksum -or $checksum.Length -lt 80) {
    Write-Err "Invalid checksum in manifest"
}

# Use default filename if not found
if (-not $filename) {
    $filename = "$APP_NAME-$arch.exe"
}

$installerUrl = "$VERSIONS_URL/latest/$filename"

Write-Info "Expected sha512: $($checksum.Substring(0, 20))..."

# Download installer with progress
$installerPath = Join-Path $DOWNLOAD_DIR $filename
$fileSizeMB = if ($fileSize -gt 0) { [math]::Round($fileSize / 1MB, 1) } else { 0 }

# Clean up any partial download from previous attempts
Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue

Write-Info "Downloading $filename ($fileSizeMB MB)..."

try {
    # Use WebRequest for download with progress
    $webRequest = [System.Net.HttpWebRequest]::Create($installerUrl)
    $webRequest.Timeout = 600000  # 10 minutes
    $response = $webRequest.GetResponse()
    $responseStream = $response.GetResponseStream()
    $fileStream = [System.IO.File]::Create($installerPath)

    $buffer = New-Object byte[] 65536
    $totalRead = 0
    $lastPercent = -1

    while (($read = $responseStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $fileStream.Write($buffer, 0, $read)
        $totalRead += $read

        if ($fileSize -gt 0) {
            $percent = [math]::Floor(($totalRead / $fileSize) * 100)
            if ($percent -ne $lastPercent) {
                $downloadedMB = [math]::Round($totalRead / 1MB, 1)
                $barWidth = 40
                # Cap at 100% for display (actual download may exceed manifest size slightly)
                $displayPercent = [math]::Min($percent, 100)
                $filled = [math]::Min([math]::Floor($displayPercent / (100 / $barWidth)), $barWidth)
                $bar = "[" + ("#" * $filled) + ("-" * ($barWidth - $filled)) + "]"
                Write-Host -NoNewline ("`r  $bar $percent% ($downloadedMB / $fileSizeMB MB)   ")
                $lastPercent = $percent
            }
        }
    }

    $fileStream.Close()
    $responseStream.Close()
    $response.Close()

    Write-Host ""
    Write-Success "Download complete!"
} catch {
    # Clean up partial download on failure
    if ($fileStream) { $fileStream.Close() }
    if ($responseStream) { $responseStream.Close() }
    if ($response) { $response.Close() }
    Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
    Write-Err "Download failed: $_"
}

# Verify file was downloaded
if (-not (Test-Path $installerPath)) {
    Write-Err "Download failed: file not found"
}

# Verify checksum (SHA-512, base64 encoded — matches electron-builder YAML manifest)
Write-Info "Verifying checksum..."
$sha512 = [System.Security.Cryptography.SHA512]::Create()
$stream = [System.IO.File]::OpenRead($installerPath)
$hashBytes = $sha512.ComputeHash($stream)
$stream.Close()
$sha512.Dispose()
$actualHash = [Convert]::ToBase64String($hashBytes)

if ($actualHash -ne $checksum) {
    Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
    Write-Err "Checksum verification failed`n  Expected: $checksum`n  Actual:   $actualHash"
}

Write-Success "Checksum verified!"

# Close the app if it's running (current brand and any pre-rebrand build)
$running = @($APP_NAME) + $LEGACY_APP_NAMES | ForEach-Object {
    Get-Process -Name $_ -ErrorAction SilentlyContinue
}
if ($running) {
    Write-Info "Closing $APP_NAME..."
    $running | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# Run the installer
Write-Info "Running installer (follow the installer prompts)..."

try {
    $installerProcess = Start-Process -FilePath $installerPath -PassThru
    $spinner = @('|', '/', '-', '\')
    $i = 0

    while (-not $installerProcess.HasExited) {
        Write-Host -NoNewline ("`r  Installing... " + $spinner[$i % 4] + "   ")
        Start-Sleep -Milliseconds 200
        $i++
    }

    Write-Host -NoNewline "`r                      `r"

    if ($installerProcess.ExitCode -ne 0) {
        Write-Err "Installation failed with exit code: $($installerProcess.ExitCode)"
    }
} catch {
    Write-Err "Installation failed: $_"
}

# Clean up installer
Write-Info "Cleaning up..."
Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue

# ── Resolve where the installer actually put the app ───────────────────────
# NSIS is configured with allowToChangeInstallationDirectory, so the install
# root is not guaranteed. Probe the default first, then the legacy roots, then
# fall back to whatever the Start Menu shortcut resolves to.
$exePath = $null
$candidateDirs = @("$env:LOCALAPPDATA\Programs\$APP_NAME") + $LEGACY_INSTALL_DIRS
foreach ($dir in $candidateDirs) {
    $candidate = Join-Path $dir "$APP_NAME.exe"
    if (Test-Path $candidate) { $exePath = $candidate; break }
}

# ── Repair shortcuts left behind by the pre-rebrand install ────────────────
# A pre-rebrand build emitted "Craft Agents.exe" (brand-leak-allow) under the mangled
# "@craft-agentelectron" directory. A later step created an ARCHstudio-named
# shortcut pointing at an ARCHstudio.exe that build never produced, so the
# Start Menu entry resolves to nothing and the app cannot be reopened after an
# update. Any shortcut of ours whose target is missing is repointed at the real
# exe, or removed if we cannot find one.
Write-Info "Checking shortcuts..."

$shortcutDirs = @(
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('StartMenu'),
    [Environment]::GetFolderPath('Programs'),
    [Environment]::GetFolderPath('CommonStartMenu'),
    [Environment]::GetFolderPath('CommonPrograms')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

$ourNames = @($APP_NAME) + $LEGACY_APP_NAMES
$shell = New-Object -ComObject WScript.Shell
$repaired = 0
$removed = 0

foreach ($dir in $shortcutDirs) {
    $links = Get-ChildItem -Path $dir -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $ourNames -contains $_.BaseName }

    foreach ($link in $links) {
        try {
            $sc = $shell.CreateShortcut($link.FullName)
            if ($sc.TargetPath -and (Test-Path $sc.TargetPath)) { continue }

            if ($exePath) {
                $sc.TargetPath = $exePath
                $sc.WorkingDirectory = Split-Path $exePath -Parent
                $sc.Save()
                $repaired++
            } else {
                Remove-Item $link.FullName -Force -ErrorAction SilentlyContinue
                $removed++
            }
        } catch {
            # A shortcut we cannot read is not worth failing the install over.
        }
    }
}

if ($repaired -gt 0) { Write-Success "Repaired $repaired stale shortcut(s)" }
if ($removed -gt 0)  { Write-Warn "Removed $removed shortcut(s) with no valid target" }

# Ensure a desktop shortcut exists — the old install never created one.
if ($exePath) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $desktopLink = Join-Path $desktop "$APP_NAME.lnk"
    if ($desktop -and -not (Test-Path $desktopLink)) {
        try {
            $sc = $shell.CreateShortcut($desktopLink)
            $sc.TargetPath = $exePath
            $sc.WorkingDirectory = Split-Path $exePath -Parent
            $sc.Save()
            Write-Success "Created desktop shortcut"
        } catch {
            Write-Warn "Could not create desktop shortcut: $_"
        }
    }
}

# ── Retire the old CLI shim ────────────────────────────────────────────────
# The pre-rebrand installer put a 'craft-agents.cmd' launcher on PATH pointing
# at the old exe. Left in place it silently launches nothing.
if (Test-Path $LEGACY_BIN_DIR) {
    Remove-Item -Path $LEGACY_BIN_DIR -Recurse -Force -ErrorAction SilentlyContinue
    $userPathNow = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPathNow -like "*$LEGACY_BIN_DIR*") {
        $cleaned = ($userPathNow -split ';' | Where-Object { $_ -and $_ -ne $LEGACY_BIN_DIR }) -join ';'
        [Environment]::SetEnvironmentVariable("Path", $cleaned, "User")
    }
    Write-Success "Removed the old 'craft-agents' command"
}

# Add command line shortcut
Write-Info "Adding '$CLI_NAME' command to PATH..."

$binDir = "$env:LOCALAPPDATA\$APP_NAME\bin"
$cmdFile = "$binDir\$CLI_NAME.cmd"
if (-not $exePath) {
    $exePath = "$env:LOCALAPPDATA\Programs\$APP_NAME\$APP_NAME.exe"
}

# Create bin directory
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

# Create batch file launcher
$cmdContent = "@echo off`r`nstart `"`" `"$exePath`" %*"
Set-Content -Path $cmdFile -Value $cmdContent -Encoding ASCII

# Add to user PATH if not already there
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$binDir*") {
    $newPath = "$userPath;$binDir"
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Success "Added to PATH (restart terminal to use '$CLI_NAME' command)"
} else {
    Write-Success "Command '$CLI_NAME' is ready"
}

Write-Host ""
Write-Host "---------------------------------------------------------------------"
Write-Host ""
Write-Success "Installation complete!"
Write-Host ""
Write-Host "  $APP_NAME has been installed."
Write-Host ""
Write-Host "  Launch from:"
Write-Host "    - Start Menu or desktop shortcut"
Write-Host "    - Command line: $CLI_NAME (restart terminal first)"
Write-Host ""
}
