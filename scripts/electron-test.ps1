param(
  [string]$ServerUrl = $env:JONWORK_TEST_SERVER_URL,
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ServerUrl)) {
  throw '请通过 -ServerUrl 或 JONWORK_TEST_SERVER_URL 指定测试服务器，例如 https://test.example.com。'
}

try {
  $uri = [Uri]$ServerUrl
} catch {
  throw '测试服务器地址格式无效。'
}
if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) {
  throw '测试服务器必须是没有账号、查询参数或片段的 HTTPS 地址。'
}
$ServerUrl = $ServerUrl.TrimEnd('/')

try {
  $policy = Invoke-RestMethod -Uri "$ServerUrl/api/auth/policy" -TimeoutSec 10
} catch {
  throw "无法连接测试 Jonwork 后端：$ServerUrl"
}
if ($policy.sso -ne $true) {
  throw '测试服务器未启用 ERPNext SSO，为防止误用本地密码，已停止启动。'
}
if ($ValidateOnly) {
  Write-Host "测试端验证通过：$ServerUrl（ERPNext SSO）"
  exit 0
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$profileRoot = Join-Path (Split-Path -Parent $repoRoot) '.jonwork-desktop-profiles\test'
New-Item -ItemType Directory -Path $profileRoot -Force | Out-Null
$env:JONWORK_CONFIG_DIR = $profileRoot
$env:CRAFT_CONFIG_DIR = $profileRoot
$env:JONWORK_DESKTOP_USER_DATA_DIR = Join-Path $profileRoot 'electron-user-data'
$env:VITE_JONWORK_DESKTOP_MODE = 'test'
$env:VITE_JONWORK_ACCOUNT_SERVER_URL = $ServerUrl
$env:CRAFT_DEBUG = 'true'

Set-Location -LiteralPath $repoRoot
Write-Host "启动测试桌面端：$ServerUrl（ERPNext SSO）"
& bun run electron:dev
exit $LASTEXITCODE
