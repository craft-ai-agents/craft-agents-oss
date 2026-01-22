# Craft Agents Windows Installer
# Usage: irm https://agents.craft.do/install-app.ps1 | iex

$ErrorActionPreference = "Stop"

$VERSIONS_URL = "https://agents.craft.do/electron"
$DOWNLOAD_DIR = "$env:TEMP\craft-agent-install"
$APP_NAME = "Craft Agents"

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
Write-Info "Detected platform: $platform"

# Create download directory
New-Item -ItemType Directory -Force -Path $DOWNLOAD_DIR | Out-Null

# Get latest version
Write-Info "Fetching latest version..."
try {
    $latestJson = Invoke-RestMethod -Uri "$VERSIONS_URL/latest" -UseBasicParsing
    $version = $latestJson.version
} catch {
    Write-Err "Failed to fetch latest version: $_"
}

if (-not $version) {
    Write-Err "Failed to get latest version"
}

Write-Info "Latest version: $version"

# Download manifest and extract checksum
Write-Info "Fetching manifest..."
try {
    $manifest = Invoke-RestMethod -Uri "$VERSIONS_URL/$version/manifest.json" -UseBasicParsing
    $binaryInfo = $manifest.binaries.$platform
    if (-not $binaryInfo) {
        Write-Err "Platform $platform not found in manifest"
    }
    $checksum = $binaryInfo.sha256
    $filename = $binaryInfo.filename
    $installerUrl = $binaryInfo.url
} catch {
    Write-Err "Failed to fetch manifest: $_"
}

# Validate checksum format
if (-not $checksum -or $checksum.Length -ne 64) {
    Write-Err "Invalid checksum in manifest"
}

# Use default filename if not in manifest
if (-not $filename) {
    $filename = "Craft-Agent-$arch.exe"
}

# Use default URL if not in manifest
if (-not $installerUrl) {
    $installerUrl = "$VERSIONS_URL/$version/$filename"
}

Write-Info "Expected checksum: $($checksum.Substring(0, 16))..."

# Download installer with progress
$installerPath = Join-Path $DOWNLOAD_DIR $filename
$fileSize = $binaryInfo.size
$fileSizeMB = [math]::Round($fileSize / 1MB, 1)

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

# Verify checksum
Write-Info "Verifying checksum..."
$actualHash = (Get-FileHash -Path $installerPath -Algorithm SHA256).Hash.ToLower()

if ($actualHash -ne $checksum) {
    Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
    Write-Err "Checksum verification failed`n  Expected: $checksum`n  Actual:   $actualHash"
}

Write-Success "Checksum verified!"

# Close the app if it's running
$process = Get-Process -Name "Craft Agents" -ErrorAction SilentlyContinue
if ($process) {
    Write-Info "Closing Craft Agents..."
    $process | Stop-Process -Force
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

# Add command line shortcut
Write-Info "Adding 'craft-agents' command to PATH..."

$binDir = "$env:LOCALAPPDATA\Craft Agents\bin"
$cmdFile = "$binDir\craft-agents.cmd"
$exePath = "$env:LOCALAPPDATA\Programs\Craft Agents\Craft Agents.exe"

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
    Write-Success "Added to PATH (restart terminal to use 'craft-agents' command)"
} else {
    Write-Success "Command 'craft-agents' is ready"
}

Write-Host ""
Write-Host "---------------------------------------------------------------------"
Write-Host ""
Write-Success "Installation complete!"
Write-Host ""
Write-Host "  Craft Agents has been installed."
Write-Host ""
Write-Host "  Launch from:"
Write-Host "    - Start Menu or desktop shortcut"
Write-Host "    - Command line: craft-agents (restart terminal first)"
Write-Host ""
