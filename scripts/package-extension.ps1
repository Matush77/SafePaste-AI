param(
  [string]$Version = "1.0.2"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"
$build = Join-Path $dist "safepaste-ai"
$zip = Join-Path $dist "safepaste-ai-$Version.zip"
$manifestPath = Join-Path $root "manifest.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json

if ($manifest.version -ne $Version) {
  throw "Manifest version $($manifest.version) does not match package version $Version"
}

if ($manifest.permissions -contains "clipboardWrite") {
  throw "Package validation failed: clipboardWrite permission is not allowed"
}

if (Test-Path $build) {
  Remove-Item -LiteralPath $build -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $build | Out-Null

$items = @(
  "manifest.json",
  "popup.html",
  "popup.css",
  "popup.js",
  "src",
  "assets",
  "privacy.html"
)

foreach ($item in $items) {
  $source = Join-Path $root $item
  $target = Join-Path $build $item
  if (Test-Path $source -PathType Container) {
    Copy-Item -LiteralPath $source -Destination $target -Recurse
  } else {
    Copy-Item -LiteralPath $source -Destination $target
  }
}

if (Test-Path (Join-Path $build "tests")) {
  throw "Package validation failed: tests directory must not be included"
}

$packagedManifest = Get-Content (Join-Path $build "manifest.json") -Raw | ConvertFrom-Json
if ($packagedManifest.permissions -contains "clipboardWrite") {
  throw "Package validation failed: packaged manifest includes clipboardWrite"
}

if (Test-Path $zip) {
  Remove-Item -LiteralPath $zip -Force
}

Compress-Archive -Path (Join-Path $build "*") -DestinationPath $zip -Force
Write-Output $zip
