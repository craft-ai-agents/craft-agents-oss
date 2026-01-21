# Self-update script for Craft Agents Electron app (Windows)
# This script is spawned by the app before quitting to install updates
#
# Usage: powershell -ExecutionPolicy Bypass -File self-update.ps1 -InstallerPath <path> -AppPath <path>
#
# Safety features:
#   - Waits for app to quit before installing
#   - Runs NSIS installer silently
#   - Relaunches app after successful installation
#   - Logs all operations for debugging

param(
    [Parameter(Mandatory=$true)]
    [string]$InstallerPath,

    [Parameter(Mandatory=$true)]
    [string]$AppPath
)

$ErrorActionPreference = "Continue"

# Logging
$LogFile = "$env:TEMP\craft-agent-update.log"

function Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LogFile -Value "$timestamp - $Message"
}

function Show-Notification {
    param(
        [string]$Title,
        [string]$Message
    )
    try {
        # Use BurntToast if available, otherwise use basic notification
        if (Get-Command -Name New-BurntToastNotification -ErrorAction SilentlyContinue) {
            New-BurntToastNotification -Text $Title, $Message
        } else {
            # Fallback: use balloon tip via .NET
            Add-Type -AssemblyName System.Windows.Forms
            $balloon = New-Object System.Windows.Forms.NotifyIcon
            $balloon.Icon = [System.Drawing.SystemIcons]::Information
            $balloon.BalloonTipTitle = $Title
            $balloon.BalloonTipText = $Message
            $balloon.Visible = $true
            $balloon.ShowBalloonTip(5000)
            Start-Sleep -Seconds 2
            $balloon.Dispose()
        }
    } catch {
        Log "Could not show notification: $_"
    }
}

Log "Starting Windows self-update"
Log "Installer: $InstallerPath"
Log "App: $AppPath"

# Validate installer path
if (-not (Test-Path -Path $InstallerPath -PathType Leaf)) {
    Log "ERROR: Installer not found at: $InstallerPath"
    Show-Notification -Title "Craft Agents" -Message "Update failed: installer not found."
    exit 1
}

# Validate installer is an exe
if (-not $InstallerPath.EndsWith(".exe")) {
    Log "ERROR: Installer is not an exe file: $InstallerPath"
    Show-Notification -Title "Craft Agents" -Message "Update failed: invalid installer."
    exit 1
}

# Show progress notification
Show-Notification -Title "Craft Agents" -Message "Installing update, please wait..."

# Wait for app to quit (max 10 seconds)
# Use the executable path to find the process, not a hardcoded name
# This is more reliable than using Get-Process -Name which may not match
$MaxWaitSeconds = 10
$WaitedSeconds = 0

Log "Waiting for app to quit..."
Log "Looking for process at: $AppPath"

# Get process by path - more reliable than by name
function Get-ProcessByPath {
    param([string]$Path)
    Get-Process | Where-Object {
        try {
            $_.Path -eq $Path -or $_.MainModule.FileName -eq $Path
        } catch {
            $false  # Process may have exited or access denied
        }
    }
}

while ($WaitedSeconds -lt $MaxWaitSeconds) {
    $processes = Get-ProcessByPath -Path $AppPath
    if (-not $processes) {
        Log "App has quit after $WaitedSeconds seconds"
        break
    }
    Log "Found $($processes.Count) matching process(es), waiting..."
    Start-Sleep -Seconds 1
    $WaitedSeconds++
}

# Force kill if still running
$processes = Get-ProcessByPath -Path $AppPath
if ($processes) {
    Log "Force killing app (PID: $($processes.Id -join ', '))..."
    $processes | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

# Brief wait for file handles to be released
Start-Sleep -Milliseconds 500

# Run NSIS installer with elevation request
# The -Verb RunAs requests admin elevation via UAC if needed
Log "Running NSIS installer (with elevation if needed)..."
try {
    # First try silent install without elevation (for per-user installs)
    $process = Start-Process -FilePath $InstallerPath -ArgumentList "/S" -Wait -PassThru -NoNewWindow -ErrorAction Stop
    $exitCode = $process.ExitCode
    Log "Installer exit code: $exitCode"

    if ($exitCode -ne 0) {
        # Non-zero exit might mean elevation needed - try with RunAs
        Log "Silent install failed (exit code $exitCode), retrying with elevation..."
        $process = Start-Process -FilePath $InstallerPath -ArgumentList "/S" -Verb RunAs -Wait -PassThru -ErrorAction Stop
        $exitCode = $process.ExitCode
        Log "Elevated installer exit code: $exitCode"

        if ($exitCode -ne 0) {
            Log "ERROR: Installer failed with exit code $exitCode"
            Show-Notification -Title "Craft Agents" -Message "Update failed: installation error."
            exit 1
        }
    }
} catch {
    Log "ERROR: Failed to run installer: $_"
    Show-Notification -Title "Craft Agents" -Message "Update failed: could not run installer."
    exit 1
}

Log "Installation successful"

# Brief wait before launching
Start-Sleep -Seconds 1

# Launch the updated app
Log "Launching updated app..."
try {
    # Use the app path if it exists, otherwise find the installed app
    if (Test-Path -Path $AppPath) {
        Start-Process -FilePath $AppPath
    } else {
        # Try common install locations
        $installPaths = @(
            "$env:LOCALAPPDATA\Programs\Craft Agents\Craft Agents.exe",
            "$env:ProgramFiles\Craft Agents\Craft Agents.exe",
            "${env:ProgramFiles(x86)}\Craft Agents\Craft Agents.exe"
        )

        $foundPath = $null
        foreach ($path in $installPaths) {
            if (Test-Path -Path $path) {
                $foundPath = $path
                break
            }
        }

        if ($foundPath) {
            Start-Process -FilePath $foundPath
            Log "Launched app from: $foundPath"
        } else {
            Log "WARNING: Could not find app to launch"
        }
    }
} catch {
    Log "WARNING: Could not launch app: $_"
}

# Clean up installer
try {
    Start-Sleep -Seconds 2  # Wait for app to start
    Remove-Item -Path $InstallerPath -Force -ErrorAction SilentlyContinue
    Log "Cleaned up installer"
} catch {
    Log "WARNING: Could not clean up installer: $_"
}

Log "Update complete!"
