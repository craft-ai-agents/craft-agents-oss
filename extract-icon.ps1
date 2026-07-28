$exePath = Join-Path $PSScriptRoot "apps\electron\release\ARCHstudio-x64.exe"
$outputPng = Join-Path $PSScriptRoot "release\extracted-icon.png"

$exePath = Resolve-Path $exePath
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exePath)
$bmp = New-Object System.Drawing.Bitmap(256, 256)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawIcon($icon, 0, 0, 256, 256)
$bmp.Save($outputPng)
$bmp.Dispose()
$g.Dispose()
$icon.Dispose()
Write-Output "Extracted icon to $outputPng"
