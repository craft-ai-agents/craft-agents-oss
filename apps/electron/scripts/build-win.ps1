# Build script for Windows NSIS installer
# Usage: powershell -ExecutionPolicy Bypass -File scripts/build-win.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ElectronDir = Split-Path -Parent $ScriptDir
$RootDir = Split-Path -Parent (Split-Path -Parent $ElectronDir)

# Configuration
$BunVersion = "bun-v1.3.9"  # Pinned version for reproducible builds

Write-Host "=== Building Craft Agents Windows Installer using electron-builder ===" -ForegroundColor Cyan

# Debug: System information
Write-Host ""
Write-Host "=== Debug: System Information ===" -ForegroundColor Magenta
Write-Host "OS: $([System.Environment]::OSVersion.VersionString)"
Write-Host "PowerShell: $($PSVersionTable.PSVersion)"
Write-Host "Hostname: $env:COMPUTERNAME"
Write-Host "User: $env:USERNAME"
Write-Host "Temp: $env:TEMP"
Write-Host "Working Dir: $(Get-Location)"

# Debug: Check Windows Defender status
Write-Host ""
Write-Host "=== Debug: Windows Defender Status ===" -ForegroundColor Magenta
try {
    $defenderStatus = Get-MpComputerStatus -ErrorAction SilentlyContinue
    if ($defenderStatus) {
        Write-Host "Real-time Protection: $($defenderStatus.RealTimeProtectionEnabled)"
        Write-Host "Antivirus Enabled: $($defenderStatus.AntivirusEnabled)"
        Write-Host "On Access Protection: $($defenderStatus.OnAccessProtectionEnabled)"
        Write-Host "IO AV Protection: $($defenderStatus.IoavProtectionEnabled)"
    } else {
        Write-Host "Could not get Defender status"
    }
} catch {
    Write-Host "Defender status check failed: $_"
}

# Debug: List exclusions
Write-Host ""
Write-Host "=== Debug: Defender Exclusions ===" -ForegroundColor Magenta
try {
    $prefs = Get-MpPreference -ErrorAction SilentlyContinue
    if ($prefs.ExclusionPath) {
        Write-Host "Path Exclusions: $($prefs.ExclusionPath -join ', ')"
    }
    if ($prefs.ExclusionProcess) {
        Write-Host "Process Exclusions: $($prefs.ExclusionProcess -join ', ')"
    }
} catch {
    Write-Host "Could not get exclusions: $_"
}
Write-Host ""

# 0. Kill any lingering processes that might lock files
Write-Host "Killing any lingering node/npm processes..."
$processesToKill = @('node', 'npm', 'electron', 'electron-builder')
foreach ($procName in $processesToKill) {
    Get-Process -Name $procName -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "  Killing $($_.ProcessName) (PID: $($_.Id))..." -ForegroundColor Yellow
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
}
# Give processes time to fully terminate
Start-Sleep -Seconds 2

# 1. Clean previous build artifacts (with retry for locked files)
Write-Host "Cleaning previous builds..."
$foldersToClean = @(
    "$ElectronDir\vendor",
    "$ElectronDir\node_modules\@anthropic-ai",
    "$ElectronDir\packages",
    "$ElectronDir\release"
)
foreach ($folder in $foldersToClean) {
    if (Test-Path $folder) {
        $retries = 3
        for ($i = 1; $i -le $retries; $i++) {
            try {
                Remove-Item -Recurse -Force $folder -ErrorAction Stop
                break
            } catch {
                if ($i -eq $retries) { throw }
                Write-Host "  Retrying cleanup of $folder (attempt $i)..." -ForegroundColor Yellow
                Start-Sleep -Seconds 2
            }
        }
    }
}

# 2. Install dependencies
Write-Host "Installing dependencies..."
Push-Location $RootDir
try {
    bun install
} finally {
    Pop-Location
}

# 3. Download Bun binary for Windows
# Use baseline build - works on all x64 CPUs (no AVX2 requirement)
Write-Host "Downloading Bun $BunVersion for Windows x64 (baseline)..."
New-Item -ItemType Directory -Force -Path "$ElectronDir\vendor\bun" | Out-Null

$BunDownload = "bun-windows-x64-baseline"
$TempDir = Join-Path $env:TEMP "bun-download-$(Get-Random)"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

try {
    # Download binary and checksums
    $ZipUrl = "https://github.com/oven-sh/bun/releases/download/$BunVersion/$BunDownload.zip"
    $ChecksumUrl = "https://github.com/oven-sh/bun/releases/download/$BunVersion/SHASUMS256.txt"

    Write-Host "Downloading from $ZipUrl..."
    Invoke-WebRequest -Uri $ZipUrl -OutFile "$TempDir\$BunDownload.zip"
    Invoke-WebRequest -Uri $ChecksumUrl -OutFile "$TempDir\SHASUMS256.txt"

    # Verify checksum
    Write-Host "Verifying checksum..."
    $ExpectedHash = (Get-Content "$TempDir\SHASUMS256.txt" | Select-String "$BunDownload.zip").ToString().Split(" ")[0]
    $ActualHash = (Get-FileHash "$TempDir\$BunDownload.zip" -Algorithm SHA256).Hash.ToLower()

    if ($ActualHash -ne $ExpectedHash) {
        throw "Checksum verification failed! Expected: $ExpectedHash, Got: $ActualHash"
    }
    Write-Host "Checksum verified successfully" -ForegroundColor Green

    # Extract and install using robocopy for better file handle management
    Write-Host "Extracting Bun..."
    Expand-Archive -Path "$TempDir\$BunDownload.zip" -DestinationPath $TempDir -Force

    # Unblock in temp first (before copy)
    Unblock-File -Path "$TempDir\$BunDownload\bun.exe" -ErrorAction SilentlyContinue

    # Use robocopy with retries - handles transient file locks better than Copy-Item
    # /R:5 = 5 retries, /W:3 = 3 second wait between retries, /NP = no progress, /NFL /NDL = quiet
    Write-Host "Copying bun.exe with robocopy..."
    $robocopyResult = robocopy "$TempDir\$BunDownload" "$ElectronDir\vendor\bun" "bun.exe" /R:5 /W:3 /NP /NFL /NDL
    # Robocopy exit codes: 0-7 are success, 8+ are errors
    if ($LASTEXITCODE -ge 8) {
        throw "robocopy failed with exit code $LASTEXITCODE"
    }

    $BunExePath = "$ElectronDir\vendor\bun\bun.exe"
    Write-Host "Bun extracted to: $BunExePath" -ForegroundColor Green

    # Give Windows time to release any file handles from the copy
    Write-Host "Waiting for file handles to release..."
    Start-Sleep -Seconds 3
} finally {
    Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
}

# 4. Copy SDK from root node_modules (monorepo hoisting)
$SdkSource = "$RootDir\node_modules\@anthropic-ai\claude-agent-sdk"
if (-not (Test-Path $SdkSource)) {
    Write-Host "ERROR: SDK not found at $SdkSource" -ForegroundColor Red
    Write-Host "Run 'bun install' from the repository root first."
    exit 1
}
Write-Host "Copying SDK..."
New-Item -ItemType Directory -Force -Path "$ElectronDir\node_modules\@anthropic-ai" | Out-Null
Copy-Item -Recurse -Force $SdkSource "$ElectronDir\node_modules\@anthropic-ai\"

# 5. Copy interceptor
$InterceptorSource = "$RootDir\packages\shared\src\unified-network-interceptor.ts"
if (-not (Test-Path $InterceptorSource)) {
    Write-Host "ERROR: Interceptor not found at $InterceptorSource" -ForegroundColor Red
    exit 1
}
Write-Host "Copying interceptor..."
New-Item -ItemType Directory -Force -Path "$ElectronDir\packages\shared\src" | Out-Null
Copy-Item $InterceptorSource "$ElectronDir\packages\shared\src\"
# Also copy dependencies imported by the interceptor at runtime
foreach ($dep in @("interceptor-common.ts", "feature-flags.ts", "interceptor-request-utils.ts")) {
    $depPath = "$RootDir\packages\shared\src\$dep"
    if (Test-Path $depPath) {
        Copy-Item $depPath "$ElectronDir\packages\shared\src\"
    }
}

# 6. Build Electron app
Write-Host "Building Electron app..."

# Build main process with OAuth credentials
Write-Host "  Building main process..."
$MainArgs = @(
    "apps/electron/src/main/index.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--outfile=apps/electron/dist/main.cjs",
    "--external:electron"
)
# Add OAuth defines if env vars are set
if ($env:GOOGLE_OAUTH_CLIENT_ID) {
    $MainArgs += "--define:process.env.GOOGLE_OAUTH_CLIENT_ID=`"'$env:GOOGLE_OAUTH_CLIENT_ID'`""
}
if ($env:GOOGLE_OAUTH_CLIENT_SECRET) {
    $MainArgs += "--define:process.env.GOOGLE_OAUTH_CLIENT_SECRET=`"'$env:GOOGLE_OAUTH_CLIENT_SECRET'`""
}
if ($env:SLACK_OAUTH_CLIENT_ID) {
    $MainArgs += "--define:process.env.SLACK_OAUTH_CLIENT_ID=`"'$env:SLACK_OAUTH_CLIENT_ID'`""
}
if ($env:SLACK_OAUTH_CLIENT_SECRET) {
    $MainArgs += "--define:process.env.SLACK_OAUTH_CLIENT_SECRET=`"'$env:SLACK_OAUTH_CLIENT_SECRET'`""
}
if ($env:MICROSOFT_OAUTH_CLIENT_ID) {
    $MainArgs += "--define:process.env.MICROSOFT_OAUTH_CLIENT_ID=`"'$env:MICROSOFT_OAUTH_CLIENT_ID'`""
}
Push-Location $RootDir
try {
    & npx esbuild @MainArgs
    if ($LASTEXITCODE -ne 0) { throw "Main process build failed" }
} finally {
    Pop-Location
}

# Build script for Windows NSIS installer
# Usage: powershell -ExecutionPolicy Bypass -File scripts/build-win.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ElectronDir = Split-Path -Parent $ScriptDir
$RootDir = Split-Path -Parent (Split-Path -Parent $ElectronDir)

# Configuration
$BunVersion = "bun-v1.3.9"  # Pinned version for reproducible builds

Write-Host "=== Building Craft Agents Windows Installer using electron-builder ===" -ForegroundColor Cyan

# Debug: System information
Write-Host ""
Write-Host "=== Debug: System Information ===" -ForegroundColor Magenta
Write-Host "OS: $([System.Environment]::OSVersion.VersionString)"
Write-Host "PowerShell: $($PSVersionTable.PSVersion)"
Write-Host "Hostname: $env:COMPUTERNAME"
Write-Host "User: $env:USERNAME"
Write-Host "Temp: $env:TEMP"
Write-Host "Working Dir: $(Get-Location)"

# Debug: Check Windows Defender status
Write-Host ""
Write-Host "=== Debug: Windows Defender Status ===" -ForegroundColor Magenta
try {
    $defenderStatus = Get-MpComputerStatus -ErrorAction SilentlyContinue
    if ($defenderStatus) {
        Write-Host "Real-time Protection: $($defenderStatus.RealTimeProtectionEnabled)"
        Write-Host "Antivirus Enabled: $($defenderStatus.AntivirusEnabled)"
        Write-Host "On Access Protection: $($defenderStatus.OnAccessProtectionEnabled)"
        Write-Host "IO AV Protection: $($defenderStatus.IoavProtectionEnabled)"
    } else {
        Write-Host "Could not get Defender status"
    }
} catch {
    Write-Host "Defender status check failed: $_"
}

# Debug: List exclusions
Write-Host ""
Write-Host "=== Debug: Defender Exclusions ===" -ForegroundColor Magenta
try {
    $prefs = Get-MpPreference -ErrorAction SilentlyContinue
    if ($prefs.ExclusionPath) {
        Write-Host "Path Exclusions: $($prefs.ExclusionPath -join ', ')"
    }
    if ($prefs.ExclusionProcess) {
        Write-Host "Process Exclusions: $($prefs.ExclusionProcess -join ', ')"
    }
} catch {
    Write-Host "Could not get exclusions: $_"
}
Write-Host ""

# 0. Kill any lingering processes that might lock files
Write-Host "Killing any lingering node/npm processes..."
$processesToKill = @('node', 'npm', 'electron', 'electron-builder')
foreach ($procName in $processesToKill) {
    Get-Process -Name $procName -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "  Killing $($_.ProcessName) (PID: $($_.Id))..." -ForegroundColor Yellow
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
}
# Give processes time to fully terminate
Start-Sleep -Seconds 2

# 1. Clean previous build artifacts (with retry for locked files)
Write-Host "Cleaning previous builds..."
$foldersToClean = @(
    "$ElectronDir\vendor",
    "$ElectronDir\node_modules\@anthropic-ai",
    "$ElectronDir\packages",
    "$ElectronDir\release"
)
foreach ($folder in $foldersToClean) {
    if (Test-Path $folder) {
        $retries = 3
        for ($i = 1; $i -le $retries; $i++) {
            try {
                Remove-Item -Recurse -Force $folder -ErrorAction Stop
                break
            } catch {
                if ($i -eq $retries) { throw }
                Write-Host "  Retrying cleanup of $folder (attempt $i)..." -ForegroundColor Yellow
                Start-Sleep -Seconds 2
            }
        }
    }
}

# 2. Install dependencies
Write-Host "Installing dependencies..."
Push-Location $RootDir
try {
    bun install
} finally {
    Pop-Location
}

# 3. Download Bun binary for Windows
# Use baseline build - works on all x64 CPUs (no AVX2 requirement)
Write-Host "Downloading Bun $BunVersion for Windows x64 (baseline)..."
New-Item -ItemType Directory -Force -Path "$ElectronDir\vendor\bun" | Out-Null

$BunDownload = "bun-windows-x64-baseline"
$TempDir = Join-Path $env:TEMP "bun-download-$(Get-Random)"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

try {
    # Download binary and checksums
    $ZipUrl = "https://github.com/oven-sh/bun/releases/download/$BunVersion/$BunDownload.zip"
    $ChecksumUrl = "https://github.com/oven-sh/bun/releases/download/$BunVersion/SHASUMS256.txt"

    Write-Host "Downloading from $ZipUrl..."
    Invoke-WebRequest -Uri $ZipUrl -OutFile "$TempDir\$BunDownload.zip"
    Invoke-WebRequest -Uri $ChecksumUrl -OutFile "$TempDir\SHASUMS256.txt"

    # Verify checksum
    Write-Host "Verifying checksum..."
    $ExpectedHash = (Get-Content "$TempDir\SHASUMS256.txt" | Select-String "$BunDownload.zip").ToString().Split(" ")[0]
    $ActualHash = (Get-FileHash "$TempDir\$BunDownload.zip" -Algorithm SHA256).Hash.ToLower()

    if ($ActualHash -ne $ExpectedHash) {
        throw "Checksum verification failed! Expected: $ExpectedHash, Got: $ActualHash"
    }
    Write-Host "Checksum verified successfully" -ForegroundColor Green

    # Extract and install using robocopy for better file handle management
    Write-Host "Extracting Bun..."
    Expand-Archive -Path "$TempDir\$BunDownload.zip" -DestinationPath $TempDir -Force

    # Unblock in temp first (before copy)
    Unblock-File -Path "$TempDir\$BunDownload\bun.exe" -ErrorAction SilentlyContinue

    # Use robocopy with retries - handles transient file locks better than Copy-Item
    # /R:5 = 5 retries, /W:3 = 3 second wait between retries, /NP = no progress, /NFL /NDL = quiet
    Write-Host "Copying bun.exe with robocopy..."
    $robocopyResult = robocopy "$TempDir\$BunDownload" "$ElectronDir\vendor\bun" "bun.exe" /R:5 /W:3 /NP /NFL /NDL
    # Robocopy exit codes: 0-7 are success, 8+ are errors
    if ($LASTEXITCODE -ge 8) {
        throw "robocopy failed with exit code $LASTEXITCODE"
    }

    $BunExePath = "$ElectronDir\vendor\bun\bun.exe"
    Write-Host "Bun extracted to: $BunExePath" -ForegroundColor Green

    # Give Windows time to release any file handles from the copy
    Write-Host "Waiting for file handles to release..."
    Start-Sleep -Seconds 3
} finally {
    Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
}

# 4. Copy SDK from root node_modules (monorepo hoisting)
$SdkSource = "$RootDir\node_modules\@anthropic-ai\claude-agent-sdk"
if (-not (Test-Path $SdkSource)) {
    Write-Host "ERROR: SDK not found at $SdkSource" -ForegroundColor Red
    Write-Host "Run 'bun install' from the repository root first."
    exit 1
}
Write-Host "Copying SDK..."
New-Item -ItemType Directory -Force -Path "$ElectronDir\node_modules\@anthropic-ai" | Out-Null
Copy-Item -Recurse -Force $SdkSource "$ElectronDir\node_modules\@anthropic-ai\"

# 5. Copy interceptor
$InterceptorSource = "$RootDir\packages\shared\src\unified-network-interceptor.ts"
if (-not (Test-Path $InterceptorSource)) {
    Write-Host "ERROR: Interceptor not found at $InterceptorSource" -ForegroundColor Red
    exit 1
}
Write-Host "Copying interceptor..."
New-Item -ItemType Directory -Force -Path "$ElectronDir\packages\shared\src" | Out-Null
Copy-Item $InterceptorSource "$ElectronDir\packages\shared\src\"
# Also copy dependencies imported by the interceptor at runtime
foreach ($dep in @("interceptor-common.ts", "feature-flags.ts", "interceptor-request-utils.ts")) {
    $depPath = "$RootDir\packages\shared\src\$dep"
    if (Test-Path $depPath) {
        Copy-Item $depPath "$ElectronDir\packages\shared\src\"
    }
}

# 6. Build Electron app
Write-Host "Building Electron app..."

# Build main process with OAuth credentials
Write-Host "  Building main process..."
$MainArgs = @(
    "apps/electron/src/main/index.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--outfile=apps/electron/dist/main.cjs",
    "--external:electron"
)
# Add OAuth defines if env vars are set
if ($env:GOOGLE_OAUTH_CLIENT_ID) {
    $MainArgs += "--define:process.env.GOOGLE_OAUTH_CLIENT_ID=`"'$env:GOOGLE_OAUTH_CLIENT_ID'`""
}
if ($env:GOOGLE_OAUTH_CLIENT_SECRET) {
    $MainArgs += "--define:process.env.GOOGLE_OAUTH_CLIENT_SECRET=`"'$env:GOOGLE_OAUTH_CLIENT_SECRET'`""
}
if ($env:SLACK_OAUTH_CLIENT_ID) {
    $MainArgs += "--define:process.env.SLACK_OAUTH_CLIENT_ID=`"'$env:SLACK_OAUTH_CLIENT_ID'`""
}
if ($env:SLACK_OAUTH_CLIENT_SECRET) {
    $MainArgs += "--define:process.env.SLACK_OAUTH_CLIENT_SECRET=`"'$env:SLACK_OAUTH_CLIENT_SECRET'`""
}
if ($env:MICROSOFT_OAUTH_CLIENT_ID) {
    $MainArgs += "--define:process.env.MICROSOFT_OAUTH_CLIENT_ID=`"'$env:MICROSOFT_OAUTH_CLIENT_ID'`""
}
Push-Location $RootDir
try {
    & npx esbuild @MainArgs
    if ($LASTEXITCODE -ne 0) { throw "Main process build failed" }
} finally {
    Pop-Location
}

