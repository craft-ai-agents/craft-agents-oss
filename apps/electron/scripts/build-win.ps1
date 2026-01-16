# Build script for Windows NSIS installer
# Usage: powershell -ExecutionPolicy Bypass -File scripts/build-win.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ElectronDir = Split-Path -Parent $ScriptDir
$RootDir = Split-Path -Parent (Split-Path -Parent $ElectronDir)

# Configuration
$BunVersion = "bun-v1.3.5"  # Pinned version for reproducible builds

Write-Host "=== Building Craft Agent Windows Installer using electron-builder ===" -ForegroundColor Cyan

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
Write-Host "Downloading Bun $BunVersion for Windows x64..."
New-Item -ItemType Directory -Force -Path "$ElectronDir\vendor\bun" | Out-Null

$BunDownload = "bun-windows-x64"
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

    # Extract and install
    Write-Host "Extracting Bun..."
    Expand-Archive -Path "$TempDir\$BunDownload.zip" -DestinationPath $TempDir -Force
    Copy-Item "$TempDir\$BunDownload\bun.exe" "$ElectronDir\vendor\bun\"

    # Unblock the file and verify it's not locked
    $BunExePath = "$ElectronDir\vendor\bun\bun.exe"
    Unblock-File -Path $BunExePath -ErrorAction SilentlyContinue

    # Wait for Windows Defender to finish scanning the executable
    # This prevents EBUSY errors when electron-builder tries to copy it later
    Write-Host "Waiting for antivirus scan to complete..."
    $maxWaitAttempts = 12  # 12 attempts * 5 seconds = 60 seconds max
    $waitAttempt = 0
    $fileAccessible = $false

    while (-not $fileAccessible -and $waitAttempt -lt $maxWaitAttempts) {
        $waitAttempt++
        Start-Sleep -Seconds 5
        try {
            $stream = [System.IO.File]::Open($BunExePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
            $stream.Close()
            $fileAccessible = $true
            Write-Host "  bun.exe is accessible (attempt $waitAttempt)" -ForegroundColor Green
        } catch {
            Write-Host "  Waiting... (attempt $waitAttempt/$maxWaitAttempts)" -ForegroundColor Yellow
        }
    }

    if (-not $fileAccessible) {
        Write-Host "WARNING: bun.exe may still be locked after $maxWaitAttempts attempts" -ForegroundColor Yellow
    }
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
$InterceptorSource = "$RootDir\packages\shared\src\cache-ttl-interceptor.ts"
if (-not (Test-Path $InterceptorSource)) {
    Write-Host "ERROR: Interceptor not found at $InterceptorSource" -ForegroundColor Red
    exit 1
}
Write-Host "Copying interceptor..."
New-Item -ItemType Directory -Force -Path "$ElectronDir\packages\shared\src" | Out-Null
Copy-Item $InterceptorSource "$ElectronDir\packages\shared\src\"

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
if ($env:MICROSOFT_OAUTH_CLIENT_SECRET) {
    $MainArgs += "--define:process.env.MICROSOFT_OAUTH_CLIENT_SECRET=`"'$env:MICROSOFT_OAUTH_CLIENT_SECRET'`""
}
Push-Location $RootDir
try {
    & npx esbuild @MainArgs
    if ($LASTEXITCODE -ne 0) { throw "Main process build failed" }
} finally {
    Pop-Location
}

# Build preload
Write-Host "  Building preload..."
Push-Location $RootDir
try {
    bun run electron:build:preload
    if ($LASTEXITCODE -ne 0) { throw "Preload build failed" }
} finally {
    Pop-Location
}

# Build renderer (frontend)
Write-Host "  Building renderer (frontend)..."
Push-Location $RootDir
try {
    # Clean previous renderer build
    $RendererDir = "$ElectronDir\dist\renderer"
    if (Test-Path $RendererDir) { Remove-Item -Recurse -Force $RendererDir }

    # Run vite build
    npx vite build --config apps/electron/vite.config.ts
    if ($LASTEXITCODE -ne 0) { throw "Renderer build failed" }

    # Verify renderer was built
    if (-not (Test-Path "$RendererDir\index.html")) {
        throw "Renderer build verification failed: index.html not found"
    }
    Write-Host "  Renderer build verified: $RendererDir" -ForegroundColor Green
} finally {
    Pop-Location
}

# Copy resources
Write-Host "  Copying resources..."
Push-Location $RootDir
try {
    $ResourcesSrc = "$ElectronDir\resources"
    $ResourcesDst = "$ElectronDir\dist\resources"
    if (Test-Path $ResourcesDst) { Remove-Item -Recurse -Force $ResourcesDst }
    Copy-Item -Recurse $ResourcesSrc $ResourcesDst
} finally {
    Pop-Location
}

# 7. Package with electron-builder (with retry for file locking issues)
Write-Host "Packaging app with electron-builder..."
Push-Location $ElectronDir
$maxRetries = 3
$retryCount = 0
$success = $false

while (-not $success -and $retryCount -lt $maxRetries) {
    try {
        $retryCount++
        if ($retryCount -gt 1) {
            Write-Host "Retry attempt $retryCount of $maxRetries..." -ForegroundColor Yellow
            Start-Sleep -Seconds 10
        }
        npx electron-builder --win --x64
        if ($LASTEXITCODE -eq 0) {
            $success = $true
        } else {
            throw "electron-builder exited with code $LASTEXITCODE"
        }
    } catch {
        Write-Host "Build attempt failed: $_" -ForegroundColor Yellow
        if ($retryCount -ge $maxRetries) {
            Pop-Location
            throw "electron-builder failed after $maxRetries attempts"
        }
    }
}
Pop-Location

# 8. Verify the installer was built
$InstallerPath = Get-ChildItem -Path "$ElectronDir\release" -Filter "*.exe" | Select-Object -First 1

if (-not $InstallerPath) {
    Write-Host "ERROR: Installer not found in $ElectronDir\release" -ForegroundColor Red
    Write-Host "Contents of release directory:"
    Get-ChildItem "$ElectronDir\release"
    exit 1
}

Write-Host ""
Write-Host "=== Build Complete ===" -ForegroundColor Green
Write-Host "Installer: $($InstallerPath.FullName)"
Write-Host "Size: $([math]::Round($InstallerPath.Length / 1MB, 2)) MB"
