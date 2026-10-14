param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')]
  [string]$Version
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Command failed (exit $LASTEXITCODE). Release stopped." }
}

$status = & git status --porcelain
if ($LASTEXITCODE -ne 0) { throw 'Cannot read Git status.' }
if ($status) { throw 'Commit your code changes before publishing, then run this command again.' }
$branch = (& git branch --show-current).Trim()
if (!$branch) { throw 'Switch to a branch before publishing.' }
$tag = "v$Version"
$localTag = & git tag --list $tag
if ($localTag) { throw "Tag $tag already exists locally. Choose an unused version." }
$remoteTag = & git ls-remote --tags origin "refs/tags/$tag"
if ($LASTEXITCODE -ne 0) { throw 'Cannot check remote tags. Nothing changed.' }
if ($remoteTag) { throw "Tag $tag already exists on GitHub. Choose an unused version." }

Invoke-Checked 'npm.cmd' @('test', '--prefix', 'app')
Invoke-Checked 'npm.cmd' @('test', '--prefix', 'server')
Invoke-Checked 'npm.cmd' @('version', $Version, '--no-git-tag-version', '--prefix', 'app')
# Windows PowerShell 5 cannot parse the empty package-lock packages[""] key.
Invoke-Checked 'node' @('-e', "const p=require('./app/package.json'),l=require('./app/package-lock.json'),v=process.argv[1];if(p.version!==v||l.version!==v||l.packages[''].version!==v)throw Error('Version files do not agree. Nothing was pushed.');", $Version)
Invoke-Checked 'git' @('add', '--', 'app/package.json', 'app/package-lock.json')
Invoke-Checked 'git' @('commit', '-m', "发布 $Version 版本")
Invoke-Checked 'git' @('tag', '-a', $tag, '-m', "发布 $Version 版本")
try {
  Invoke-Checked 'git' @('push', '--atomic', 'origin', "HEAD:refs/heads/$branch", "refs/tags/$tag")
} catch {
  Write-Host "The local release is preserved. Retry: git push --atomic origin HEAD:refs/heads/$branch refs/tags/$tag"
  throw
}
Write-Host "Pushed $tag. GitHub Actions will build and publish the installer. Check the Actions result before distributing it."
