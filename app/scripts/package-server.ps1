$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskProject=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskVersion=(Get-Content -LiteralPath (Join-Path $taskProject 'app/package.json') -Raw | ConvertFrom-Json).version
$taskOutput=Join-Path $taskProject 'app/dist'
New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
$taskTarget=Join-Path $taskOutput "ScreenSh-$taskVersion-server.zip"
$taskFiles=@('server.js','network-settings.cjs','chat-store.cjs','easytier-peers.cjs','lolping-protocol.cjs','package.json','package-lock.json','Dockerfile','compose.yaml','.dockerignore','mediamtx.external.compose.yaml','mediamtx.external.yml','mediamtx.direct.yml','mediamtx.nas-network-settings.yml','部署教程.md','视频流转发部署.md')
$taskStream=[System.IO.File]::Open($taskTarget,[System.IO.FileMode]::Create)
$taskArchive=[System.IO.Compression.ZipArchive]::new($taskStream,[System.IO.Compression.ZipArchiveMode]::Create)
try { foreach($taskFile in $taskFiles){[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($taskArchive,(Join-Path $taskProject "server/$taskFile"),"screensh-server/$taskFile",[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null} }
finally { $taskArchive.Dispose();$taskStream.Dispose() }
Write-Output "Server archive: $taskTarget"
