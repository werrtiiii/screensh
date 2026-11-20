$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$manifestPaths = @(Get-ChildItem -LiteralPath "$PSScriptRoot/../dist" -Filter '*-hotfix.json' -File)
if ($manifestPaths.Count -ne 1) { throw 'Expected exactly one hotfix index in dist.' }
$indexFile = $manifestPaths[0]
$index = Get-Content -Raw -LiteralPath $indexFile.FullName | ConvertFrom-Json
$key = "$($index.version)-b$($index.build)"
if ($env:RELEASE_TAG -cne "hotfix-$key") { throw 'Hotfix tag differs from the built index.' }
$dir = $indexFile.DirectoryName
$installer = "$dir/ScreenSh-$key-Setup.exe"
Copy-Item -LiteralPath "$dir/ScreenSh-$($index.version)-Setup.exe" -Destination $installer
$files = @($installer, "$dir/ScreenSh-$key-Update.zip", "$dir/ScreenSh-$key-Update.json", "$dir/ScreenSh-$key-Blocks.bin")
$repo = "$env:GH_OWNER/$env:GH_REPO"
$tag = [string]$index.version

# Versioned payloads and the build index all live on the formal release page.
try {
  $release = gh api "repos/$repo/releases/tags/$tag" | ConvertFrom-Json
} catch {
  $tag = "v$tag"
  $release = gh api "repos/$repo/releases/tags/$tag" | ConvertFrom-Json
}
if ($release.draft -or $release.prerelease -or $release.immutable) { throw 'Build updates require a published, editable formal release.' }
if ($release.assets.name -ccontains $indexFile.Name) {
  $previous = gh release download $tag --repo $repo --pattern $indexFile.Name --output - | ConvertFrom-Json
  if ($previous.version -cne $index.version -or [int]$previous.build -ge [int]$index.build) { throw 'Build index must advance to a higher build.' }
}

# Unique build filenames keep an interrupted upload from changing the active build.
gh release upload $tag @files --repo $repo
$published = gh api "repos/$repo/releases/tags/$tag" | ConvertFrom-Json
foreach ($file in $files) {
  $item = Get-Item -LiteralPath $file
  $asset = $published.assets | Where-Object name -CEQ $item.Name
  $digest = 'sha256:' + (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  if (-not $asset -or $asset.size -ne $item.Length -or $asset.digest -cne $digest) { throw "Published asset does not match: $($item.Name)" }
}
gh release upload $tag $indexFile.FullName --repo $repo --clobber
