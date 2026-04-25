$env:PATH = 'C:\Users\ninjaeon\AppData\Roaming\npm\node_modules\bun\bin;' + $env:PATH
& $PSScriptRoot\build-win.ps1 @args
