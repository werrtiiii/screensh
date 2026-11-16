param([Parameter(Mandatory=$true)][string]$JobFile)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$job=Get-Content -LiteralPath $JobFile -Raw -Encoding UTF8|ConvertFrom-Json
$zip=[IO.Compression.ZipFile]::Open($job.archive,[IO.Compression.ZipArchiveMode]::Create)
try{
 foreach($file in $job.manifest.files){
  [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,(Join-Path $job.source $file.path),$file.path,[IO.Compression.CompressionLevel]::Optimal)
 }
 $entry=$zip.CreateEntry('update-manifest.json');$writer=New-Object IO.StreamWriter($entry.Open(),(New-Object Text.UTF8Encoding($false)))
 try{$writer.Write(($job.manifest|ConvertTo-Json -Depth 6 -Compress))}finally{$writer.Dispose()}
}finally{$zip.Dispose()}
