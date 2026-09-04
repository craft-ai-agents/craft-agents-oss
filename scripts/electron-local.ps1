param(
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$profileRoot = Join-Path (Split-Path -Parent $repoRoot) '.jonwork-desktop-profiles\local'
$serverUrl = 'http://127.0.0.1:9100'

try {
  $policy = Invoke-RestMethod -Uri "$serverUrl/api/auth/policy" -TimeoutSec 5
} catch {
  throw "本地 Jonwork 后端未启动。请先运行 bun run server:dev:webui，确认 $serverUrl/health 可访问。"
}
if ($policy.sso -eq $true) {
  throw '本地端返回了 ERP SSO 策略，请检查是否连接到了错误的服务。'
}
if ($ValidateOnly) {
  Write-Host "本地端验证通过：$serverUrl（本地账号登录）"
  exit 0
}

New-Item -ItemType Directory -Path $profileRoot -Force | Out-Null
$env:JONWORK_CONFIG_DIR = $profileRoot
$env:CRAFT_CONFIG_DIR = $profileRoot
$env:JONWORK_DESKTOP_USER_DATA_DIR = Join-Path $profileRoot 'electron-user-data'
$env:VITE_JONWORK_DESKTOP_MODE = 'local'
$env:VITE_JONWORK_ACCOUNT_SERVER_URL = $serverUrl
$env:CRAFT_DEBUG = 'true'

Set-Location -LiteralPath $repoRoot
Write-Host "启动本地桌面端：$serverUrl"
& bun run electron:dev
exit $LASTEXITCODE
