# Builds "Retro Library.exe" next to the retro-library folder, using the C# compiler built into Windows.
# Run from anywhere: powershell -ExecutionPolicy Bypass -File launcher\build.ps1
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$out = Join-Path (Split-Path (Split-Path $here -Parent) -Parent) 'Retro Library.exe'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "C# compiler not found at $csc" }
& $csc /nologo /target:winexe /optimize+ "/win32icon:$here\icon.ico" "/out:$out" /reference:System.Windows.Forms.dll "$here\Launcher.cs"
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
Write-Output "Built $out"
