$ErrorActionPreference = 'Stop'

$parts = Get-ChildItem -Path $PSScriptRoot -Filter 'codex-usage-bar-v1.2.1.zip.b64.part*' |
    Sort-Object Name

if ($parts.Count -ne 6) {
    throw "Expected 6 archive parts, found $($parts.Count)."
}

$base64 = ($parts | ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName }) -join ''
$bytes = [Convert]::FromBase64String($base64)
$output = Join-Path $PSScriptRoot 'codex-usage-bar-v1.2.1.zip'
[IO.File]::WriteAllBytes($output, $bytes)

$expected = 'bdcdebcc6786642438cedb24f657d03ca3a9fdda38b041769231e8df18dceaca'
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $output).Hash.ToLowerInvariant()
if ($actual -ne $expected) {
    Remove-Item -LiteralPath $output -Force
    throw "SHA-256 mismatch. Expected $expected, got $actual."
}

Write-Host "Created: $output"
Write-Host "SHA-256: $actual"
