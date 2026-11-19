$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$manifestPaths = @(Get-ChildItem -LiteralPath "$PSScriptRoot/../dist" -Filter '*-hotfix.json' -File)
if ($manifestPaths.Count -ne 1) { throw 'Expected exactly one hotfix index in dist.' }
$indexFile = $manifestPaths[0]
$index = Get-Content -Raw -LiteralPath $indexFile.FullName | ConvertFrom-Json
$key = "$($index.version)-b$($index.build)"
if ($env:RELEASE_TAG -cne "hotfix-$key") { throw 'Hotfix tag differs from the built index.' }
$dir = $indexFile.DirectoryName
$files = @("$dir/ScreenSh-$key-Update.zip", "$dir/ScreenSh-$key-Update.json", "$dir/ScreenSh-$key-Blocks.bin")
$repo = "$env:GH_OWNER/$env:GH_REPO"

# The index release must stay out of the legacy latest-version feed.
try {
  $channel = gh release view hotfix-index --repo $repo --json isDraft,isPrerelease,assets | ConvertFrom-Json
} catch {
  gh release create hotfix-index --repo $repo --prerelease --latest=false --title 'ScreenSh hotfix indexes' --notes 'Same-version build update metadata.'
  $channel = gh release view hotfix-index --repo $repo --json isDraft,isPrerelease,assets | ConvertFrom-Json
}
if ($channel.isDraft -or -not $channel.isPrerelease) { throw 'Hotfix index release must be a published prerelease.' }
if ($channel.assets.name -ccontains $indexFile.Name) {
  $previous = gh release download hotfix-index --repo $repo --pattern $indexFile.Name --output - | ConvertFrom-Json
  if ($previous.version -cne $index.version -or [int]$previous.build -ge [int]$index.build) { throw 'Hotfix index must advance to a higher build.' }
}

# Creating an existing release fails. This prevents reusing a build identity.
gh release create $env:RELEASE_TAG @files --repo $repo --verify-tag --prerelease --latest=false --title "ScreenSh $($index.version) build $($index.build)" --notes 'Same-version ScreenSh update packages.'
$published = gh api "repos/$repo/releases/tags/$($env:RELEASE_TAG)" | ConvertFrom-Json
if ($published.draft -or -not $published.prerelease) { throw 'Hotfix release is not a published prerelease.' }
foreach ($file in $files) {
  $item = Get-Item -LiteralPath $file
  $asset = $published.assets | Where-Object name -CEQ $item.Name
  $digest = 'sha256:' + (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  if (-not $asset -or $asset.size -ne $item.Length -or $asset.digest -cne $digest) { throw "Published asset does not match: $($item.Name)" }
}
gh release upload hotfix-index $indexFile.FullName --repo $repo --clobber
