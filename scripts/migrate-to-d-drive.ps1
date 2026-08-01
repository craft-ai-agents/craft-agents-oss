# ARCHstudio Data Migration Script — C: → D:
# =================================================
# Run this AFTER closing ARCHstudio and rebuilding the app with the
# CONFIG_DIR code changes. Requires PowerShell (run as Administrator
# for the system env var at the end).
#
# Usage:
#   1. Close ARCHstudio completely
#   2. Rebuild: cd D:\ARCHstudio && bun run build
#   3. Run this script in an elevated PowerShell:
#      powershell -ExecutionPolicy Bypass -File D:\ARCHstudio\scripts\migrate-to-d-drive.ps1

$ErrorActionPreference = "Stop"

$SourceCraftAgent = "C:\Users\skobe\.archstudio"
$SourceArchstudio = "C:\Users\skobe\.archstudio"
$SourceAppData    = "$env:APPDATA\ARCHstudio"
$DestDir          = "D:\AI\archstudio"
$DestElectronData = "$DestDir\electron-data"
$VaultPath        = "D:\AI\vault"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  ARCHstudio Data Migration: C: → D:" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Step 0: Verify destination exists
if (-not (Test-Path $DestDir)) {
    New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
    Write-Host "[OK] Created $DestDir" -ForegroundColor Green
}

# Step 1: Copy .archstudio (primary data — workspaces, credentials, docs, etc.)
if (Test-Path $SourceCraftAgent) {
    Write-Host "[1/4] Copying .archstudio → D:\AI\archstudio ..." -ForegroundColor Yellow
    robocopy $SourceCraftAgent $DestDir /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    Write-Host "[OK] Copied .archstudio data" -ForegroundColor Green
} else {
    Write-Host "[SKIP] .archstudio not found at $SourceCraftAgent" -ForegroundColor DarkGray
}

# Step 2: Copy .archstudio (merge — config.json, preferences, themes from split-brain)
# Only copy files that don't already exist (prefer .archstudio versions)
if (Test-Path $SourceArchstudio) {
    Write-Host "[2/4] Merging .archstudio → D:\AI\archstudio (non-overwrite) ..." -ForegroundColor Yellow
    robocopy $SourceArchstudio $DestDir /E /XO /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    Write-Host "[OK] Merged .archstudio data" -ForegroundColor Green
} else {
    Write-Host "[SKIP] .archstudio not found at $SourceArchstudio" -ForegroundColor DarkGray
}

# Step 3: Copy %APPDATA%\ARCHstudio → electron-data (memory DB, health DB, vault)
if (Test-Path $SourceAppData) {
    Write-Host "[3/4] Copying %APPDATA%\ARCHstudio → electron-data ..." -ForegroundColor Yellow
    if (-not (Test-Path $DestElectronData)) {
        New-Item -ItemType Directory -Path $DestElectronData -Force | Out-Null
    }
    robocopy $SourceAppData $DestElectronData /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    Write-Host "[OK] Copied Electron userData" -ForegroundColor Green
} else {
    Write-Host "[SKIP] %APPDATA%\ARCHstudio not found" -ForegroundColor DarkGray
}

# Step 4: Set memoryVaultPath in config.json
$ConfigFile = Join-Path $DestDir "config.json"
if (Test-Path $ConfigFile) {
    Write-Host "[4/4] Setting memoryVaultPath in config.json ..." -ForegroundColor Yellow
    $config = Get-Content $ConfigFile -Raw | ConvertFrom-Json
    if (-not $config.PSObject.Properties['memoryVaultPath']) {
        $config | Add-Member -NotePropertyName "memoryVaultPath" -NotePropertyValue $VaultPath
    } else {
        $config.memoryVaultPath = $VaultPath
    }
    $config | ConvertTo-Json -Depth 10 | Set-Content $ConfigFile -Encoding UTF8
    Write-Host "[OK] memoryVaultPath set to $VaultPath" -ForegroundColor Green
} else {
    Write-Host "[WARN] config.json not found at $ConfigFile — will use default vault path" -ForegroundColor DarkYellow
}

# Step 5: Set system environment variable (requires admin)
Write-Host ""
Write-Host "[5/5] Setting ARCHSTUDIO_CONFIG_DIR system environment variable ..." -ForegroundColor Yellow
try {
    [Environment]::SetEnvironmentVariable("ARCHSTUDIO_CONFIG_DIR", $DestDir, "Machine")
    Write-Host "[OK] ARCHSTUDIO_CONFIG_DIR=$DestDir set as system env var" -ForegroundColor Green
} catch {
    Write-Host "[WARN] Could not set system env var (need admin). Setting user-level instead." -ForegroundColor DarkYellow
    [Environment]::SetEnvironmentVariable("ARCHSTUDIO_CONFIG_DIR", $DestDir, "User")
    Write-Host "[OK] ARCHSTUDIO_CONFIG_DIR=$DestDir set as user env var" -ForegroundColor Green
}

# Done
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Migration Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Rebuild the app:  cd D:\ARCHstudio && bun run build" -ForegroundColor Gray
Write-Host "  2. Launch ARCHstudio" -ForegroundColor Gray
Write-Host "  3. Verify workspaces, memory, and vault load from D:" -ForegroundColor Gray
Write-Host "  4. If everything works, delete old C: data:" -ForegroundColor Gray
Write-Host "     - C:\Users\skobe\.archstudio\" -ForegroundColor DarkGray
Write-Host "     - C:\Users\skobe\.archstudio\" -ForegroundColor DarkGray
Write-Host "     - %APPDATA%\ARCHstudio\" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Data layout on D:" -ForegroundColor White
Write-Host "  D:\AI\archstudio\          ← ARCHSTUDIO_CONFIG_DIR (all app data)" -ForegroundColor Gray
Write-Host "    config.json" -ForegroundColor DarkGray
Write-Host "    workspaces\" -ForegroundColor DarkGray
Write-Host "    credentials.enc" -ForegroundColor DarkGray
Write-Host "    docs/" -ForegroundColor DarkGray
Write-Host "    electron-data\           ← memory DB, health DB" -ForegroundColor Gray
Write-Host "      vault\" -ForegroundColor DarkGray
Write-Host "  D:\AI\vault\               ← Obsidian vault (memoryVaultPath)" -ForegroundColor Gray
Write-Host "  D:\AI\projects\            ← future AI projects" -ForegroundColor Gray
Write-Host ""