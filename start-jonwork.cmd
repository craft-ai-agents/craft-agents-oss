@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 (
  echo [Jonwork] Failed to enter the project directory.
  pause
  exit /b 1
)

if /i "%~1"=="help" goto usage
if /i "%~1"=="--help" goto usage
if /i "%~1"=="/?" goto usage
if not "%~1"=="" if /i not "%~1"=="clean" if /i not "%~1"=="--check" if /i not "%~1"=="--validate-only" goto invalid_argument

where bun >nul 2>nul
if errorlevel 1 (
  echo [Jonwork] Bun was not found in PATH.
  echo Install Bun, reopen the terminal, and try again.
  pause
  popd
  exit /b 1
)

if /i "%~1"=="--check" goto check

set "JONWORK_INSTALL_MARKER=%~dp0node_modules\.jonwork-install-complete"
if not exist "%JONWORK_INSTALL_MARKER%" (
  echo [Jonwork] Project dependencies are missing. Installing them now...
  set "JONWORK_BUN_CACHE=%LOCALAPPDATA%\Jonwork\bun-cache"
  if not exist "%JONWORK_BUN_CACHE%" mkdir "%JONWORK_BUN_CACHE%"
  call bun install --no-save --backend=copyfile --cache-dir="%JONWORK_BUN_CACHE%"
  if errorlevel 1 (
    echo [Jonwork] Dependency installation failed. Existing instance was not closed.
    pause
    popd
    exit /b 1
  )
  >"%JONWORK_INSTALL_MARKER%" echo Installed by start-jonwork.cmd
  echo [Jonwork] Project dependencies installed.
)

set "JONWORK_SERVER_URL=http://127.0.0.1:9100"
for %%I in ("%~dp0..\.jonwork-desktop-profiles\local") do set "JONWORK_PROFILE_ROOT=%%~fI"
set "JONWORK_CONFIG_DIR=%JONWORK_PROFILE_ROOT%"
set "CRAFT_CONFIG_DIR=%JONWORK_PROFILE_ROOT%"
set "JONWORK_DESKTOP_USER_DATA_DIR=%JONWORK_PROFILE_ROOT%\electron-user-data"
set "VITE_JONWORK_DESKTOP_MODE=local"
set "VITE_JONWORK_ACCOUNT_SERVER_URL=%JONWORK_SERVER_URL%"
set "CRAFT_DEBUG=true"

echo [Jonwork] Checking the local backend at %JONWORK_SERVER_URL%...
powershell.exe -NoProfile -Command "try { $policy = Invoke-RestMethod -Uri '%JONWORK_SERVER_URL%/api/auth/policy' -TimeoutSec 5 } catch { Write-Error 'The local Jonwork backend is not running. Start it with: bun run server:dev:webui'; exit 1 }; if ($policy.sso -eq $true) { Write-Error 'The local backend returned an ERP SSO policy. Check that port 9100 points to the local service.'; exit 1 }"
if errorlevel 1 (
  echo [Jonwork] Local backend validation failed. Existing instance was not closed.
  pause
  popd
  exit /b 1
)
echo [Jonwork] Local backend validation passed.
if /i "%~1"=="--validate-only" goto validate

set "JONWORK_LOCK=%JONWORK_PROFILE_ROOT%\.server.lock"
set "JONWORK_PID="
if exist "%JONWORK_LOCK%" for /f "tokens=2 delims=:," %%P in ('findstr /i "pid" "%JONWORK_LOCK%"') do set "JONWORK_PID=%%P"
if defined JONWORK_PID set "JONWORK_PID=%JONWORK_PID: =%"
if defined JONWORK_PID powershell.exe -NoProfile -Command "if (Get-Process -Id %JONWORK_PID% -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>nul
if defined JONWORK_PID if not errorlevel 1 (
  echo [Jonwork] Closing the existing instance ^(PID %JONWORK_PID%^)...
  powershell.exe -NoProfile -Command "$process = Get-Process -Id %JONWORK_PID% -ErrorAction SilentlyContinue; if ($process) { $null = $process.CloseMainWindow(); if (-not $process.WaitForExit(10000)) { Stop-Process -Id %JONWORK_PID% -Force } }"
  powershell.exe -NoProfile -Command "$deadline = (Get-Date).AddSeconds(8); while ((Get-Date) -lt $deadline) { if (-not (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)) { exit 0 }; Start-Sleep -Milliseconds 200 }; exit 1" >nul 2>nul
  if errorlevel 1 (
    echo [Jonwork] Stopping the previous development server...
    powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
    powershell.exe -NoProfile -Command "$deadline = (Get-Date).AddSeconds(5); while ((Get-Date) -lt $deadline) { if (-not (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)) { exit 0 }; Start-Sleep -Milliseconds 200 }; exit 1" >nul 2>nul
    if errorlevel 1 (
      echo [Jonwork] Port 5173 is still occupied. Restart cancelled.
      pause
      popd
      exit /b 1
    )
  )
  echo [Jonwork] Previous instance stopped.
)

set "JONWORK_LOG_DIR=%~dp0logs"
set "JONWORK_LOG=%JONWORK_LOG_DIR%\jonwork-dev-console.log"
set "JONWORK_ERR_LOG=%JONWORK_LOG_DIR%\jonwork-dev-error.log"
set "JONWORK_LAUNCH_PID_FILE=%JONWORK_LOG_DIR%\jonwork-dev-launch.pid"
if not exist "%JONWORK_LOG_DIR%" mkdir "%JONWORK_LOG_DIR%"

if /i "%~1"=="clean" goto clean

echo [Jonwork] Starting the development environment...
echo [Jonwork] Detailed log: %JONWORK_LOG%
goto launch

:clean
set "JONWORK_CLEAN_VITE_CACHE=true"
echo [Jonwork] Rebuilding the frontend cache and starting...
echo [Jonwork] Detailed log: %JONWORK_LOG%
goto launch

:launch
powershell.exe -NoProfile -Command "$project = [IO.Path]::GetFullPath('%~dp0'); $bun = (Get-Command bun.exe -ErrorAction Stop).Source; $process = Start-Process -FilePath $bun -ArgumentList @('run', 'electron:dev') -WorkingDirectory $project -RedirectStandardOutput '%JONWORK_LOG%' -RedirectStandardError '%JONWORK_ERR_LOG%' -WindowStyle Hidden -PassThru; Set-Content -LiteralPath '%JONWORK_LAUNCH_PID_FILE%' -Value $process.Id -Encoding ascii"
if errorlevel 1 goto launch_failed

echo [Jonwork] Waiting for the interface to become ready...
powershell.exe -NoProfile -Command "$pidFile = '%JONWORK_LAUNCH_PID_FILE%'; $processId = [int](Get-Content -LiteralPath $pidFile -ErrorAction Stop); $deadline = (Get-Date).AddSeconds(120); while ((Get-Date) -lt $deadline) { if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { exit 0 }; if (-not (Get-Process -Id $processId -ErrorAction SilentlyContinue)) { exit 1 }; Start-Sleep -Milliseconds 500 }; exit 2" >nul 2>nul
if errorlevel 1 goto launch_failed

echo [Jonwork] Development server is ready. The desktop window is loading.
echo [Jonwork] This launcher can now be closed.
echo [Jonwork] Run .\start-jonwork.cmd --help to see startup examples.
popd
exit /b 0

:check
echo [Jonwork] Launcher check passed.
popd
exit /b 0

:validate
echo [Jonwork] Launcher and local backend check passed.
popd
exit /b 0

:launch_failed
echo.
echo [Jonwork] The development environment failed to become ready.
echo [Jonwork] Last log lines:
powershell.exe -NoProfile -Command "Get-Content -LiteralPath '%JONWORK_LOG%' -Tail 15 -ErrorAction SilentlyContinue; Get-Content -LiteralPath '%JONWORK_ERR_LOG%' -Tail 15 -ErrorAction SilentlyContinue"
pause
popd
exit /b 1

:usage
call :print_usage
popd
exit /b 0

:invalid_argument
echo [Jonwork] Unknown option: %~1
echo.
call :print_usage
popd
exit /b 2

:print_usage
echo Jonwork desktop development launcher
echo.
echo Usage examples:
echo   .\start-jonwork.cmd                 Start local development normally
echo   .\start-jonwork.cmd clean           Clear the Vite cache, then start
echo   .\start-jonwork.cmd --validate-only Validate the local backend without starting
echo   .\start-jonwork.cmd --check         Check launcher prerequisites
echo   .\start-jonwork.cmd --help          Show this help
echo.
echo Local backend: http://127.0.0.1:9100
echo Development UI: http://127.0.0.1:5173
exit /b 0
