param([string]$InterfaceName, [switch]$Legacy, [switch]$Apply, [string]$BackupDirectory)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
if (!$Legacy -and $InterfaceName -notmatch '^ScreenSh-[a-f0-9]{16}$') { throw 'Invalid ScreenSh interface name' }

function Get-PresentInterfaces {
  # Include disconnected/hidden adapters: a disconnected adapter is not stale.
  $present = @{}
  foreach ($adapter in @(Get-NetAdapter -IncludeHidden -ErrorAction Stop)) {
    $present[[string]$adapter.Name] = $true
    $present[[string]$adapter.InterfaceGuid] = $true
    $present[([string]$adapter.InterfaceGuid).Trim('{}')] = $true
  }
  if (!$present.Count) { throw 'Cannot safely enumerate network adapters' }
  return $present
}

$policy = New-Object -ComObject HNetCfg.FwPolicy2
$scopedRules = @()
if ($Legacy) { $scopedRules = @($policy.Rules) }
else {
  foreach ($protocolName in @('TCP', 'UDP', 'ICMP', 'ALL')) {
    foreach ($directionName in @('Inbound', 'Outbound')) {
      try { $scopedRules += $policy.Rules.Item("EasyTier $InterfaceName - $protocolName Protocol ($directionName)") } catch { }
    }
  }
}
$present = if ($scopedRules.Count) { Get-PresentInterfaces } else { @{} }
$candidates = @()
foreach ($rule in $scopedRules) {
  if ($rule.Name -notmatch '^EasyTier (?<adapter>et_[a-zA-Z0-9_]+|ScreenSh-[a-f0-9]{16}) - (?<proto>TCP|UDP|ICMP|ALL) Protocol \((?<direction>Inbound|Outbound)\)$') { continue }
  $adapterName = $Matches.adapter
  $protocol = @{ TCP = 6; UDP = 17; ICMP = 1; ALL = 256 }[$Matches.proto]
  $direction = if ($Matches.direction -eq 'Inbound') { 1 } else { 2 }
  if ((!$Legacy -and $adapterName -ne $InterfaceName) -or ($Legacy -and $adapterName -notmatch '^et_')) { continue }
  if ($rule.Grouping -ne 'EasyTier' -or $rule.ApplicationName -or $rule.Action -ne 1) { continue }
  $interfaces = @($rule.Interfaces)
  if ($interfaces.Count -ne 1 -or $rule.Protocol -ne $protocol -or $rule.Direction -ne $direction) { continue }
  # Windows resolves a removed adapter's friendly name back to its old GUID.
  if ($interfaces[0] -ne $adapterName -and $interfaces[0] -notmatch '^\{[a-fA-F0-9-]{36}\}$') { continue }
  if ($present.ContainsKey($adapterName) -or $present.ContainsKey([string]$interfaces[0])) { continue }
  $candidates += [PSCustomObject]@{ name = [string]$rule.Name; adapter = $adapterName; interface = [string]$interfaces[0] }
}
# Rules.Remove uses the display name. Do not remove ambiguous duplicate names.
$candidates = @($candidates | Group-Object name | Where-Object Count -eq 1 | ForEach-Object { $_.Group[0] })
$removed = 0
$backup = $null
if ($Apply -and $candidates.Count) {
  if (!$BackupDirectory -or ![IO.Path]::IsPathRooted($BackupDirectory)) { throw 'A backup directory is required' }
  [void][IO.Directory]::CreateDirectory($BackupDirectory)
  $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N')
  $backup = Join-Path $BackupDirectory ($stamp + '.wfw')
  $netsh = Join-Path $env:SystemRoot 'System32\netsh.exe'
  $exportOutput = & $netsh advfirewall export $backup 2>&1
  if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $backup) -or (Get-Item -LiteralPath $backup).Length -eq 0) { throw "Firewall backup failed; nothing was removed. $exportOutput" }
  $candidates | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $BackupDirectory ($stamp + '.json')) -Encoding UTF8
  # Recheck after backup, since another EasyTier instance may have started.
  $present = Get-PresentInterfaces
  foreach ($candidate in $candidates) {
    if ($present.ContainsKey($candidate.adapter) -or $present.ContainsKey($candidate.interface)) { continue }
    $rule = $policy.Rules.Item($candidate.name)
    if ($rule.Grouping -ne 'EasyTier' -or $rule.ApplicationName -or @($rule.Interfaces).Count -ne 1 -or @($rule.Interfaces)[0] -ne $candidate.interface) { continue }
    $policy.Rules.Remove($candidate.name)
    $removed++
  }
}
[PSCustomObject]@{ candidates = $candidates.Count; removed = $removed; backup = $backup } | ConvertTo-Json -Compress
