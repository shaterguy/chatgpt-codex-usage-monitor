$ErrorActionPreference = 'Stop'

$parts = Get-ChildItem -Path $PSScriptRoot -Filter 'codex-usage-bar-v1.2.0.zip.b64.part*' |
    Sort-Object Name

if ($parts.Count -ne 5) {
    throw "Expected 5 archive parts, found $($parts.Count)."
}

$base64 = ($parts | ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName }) -join ''
$bytes = [Convert]::FromBase64String($base64)
$output = Join-Path $PSScriptRoot 'codex-usage-bar-v1.2.0.zip'
[IO.File]::WriteAllBytes($output, $bytes)

$expected = 'f4a4cd170999c26c45bd8bd2e8d67d779af676bfee165a0959c4d790f3d85000'
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $output).Hash.ToLowerInvariant()
if ($actual -ne $expected) {
    Remove-Item -LiteralPath $output -Force
    throw "SHA-256 mismatch. Expected $expected, got $actual."
}

Write-Host "Created: $output"
Write-Host "SHA-256: $actual"
